require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query, migrate } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Dates are computed in the server's local timezone.
function localDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function computeStreak() {
  const { rows } = await query(
    'SELECT day FROM activity WHERE xp > 0 ORDER BY day DESC LIMIT 400'
  );
  const days = new Set(rows.map((r) => r.day));
  let streak = 0;
  // Streak survives if today has no XP yet, as long as yesterday does.
  let cursor = new Date();
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localDay(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function weekDays() {
  // Monday-start week containing today
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0
  const days = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(d);
    x.setDate(d.getDate() - dow + i);
    days.push(localDay(x));
  }
  return days;
}

function asyncRoute(handler) {
  return (req, res) =>
    handler(req, res).catch((e) => {
      console.error(e);
      res.status(500).json({ error: e.message });
    });
}

async function fullState() {
  const settings = (await query('SELECT * FROM settings WHERE id = 1')).rows[0];
  const week = weekDays();
  const weekRows = (
    await query('SELECT day, xp FROM activity WHERE day = ANY($1::text[])', [week])
  ).rows;
  const byDay = Object.fromEntries(weekRows.map((r) => [r.day, r.xp]));
  const weekXp = week.map((day) => ({ day, xp: byDay[day] || 0 }));
  const todayRow = (
    await query('SELECT xp FROM activity WHERE day = $1', [localDay(new Date())])
  ).rows[0];
  const totalXp = (await query('SELECT COALESCE(SUM(xp),0) AS t FROM activity')).rows[0].t;
  const progressRows = (
    await query('SELECT lesson_id, completions, best_score FROM lesson_progress')
  ).rows;
  const progress = {};
  for (const r of progressRows) {
    progress[r.lesson_id] = { completions: r.completions, bestScore: r.best_score };
  }
  const lessonsDone = progressRows.filter(
    (r) => r.completions > 0 && r.lesson_id !== 'review'
  ).length;
  return {
    settings: {
      dailyGoal: settings.daily_goal,
      romanizationMode: settings.romanization_mode,
      soundEffects: settings.sound_effects,
    },
    streak: await computeStreak(),
    todayXp: todayRow ? Number(todayRow.xp) : 0,
    weekXp,
    weekTotal: weekXp.reduce((s, d) => s + d.xp, 0),
    totalXp: Number(totalXp),
    lessonsDone,
    progress,
  };
}

// ---------- App state ----------
app.get(
  '/api/state',
  asyncRoute(async (req, res) => {
    res.json(await fullState());
  })
);

app.put(
  '/api/settings',
  asyncRoute(async (req, res) => {
    const s = (await query('SELECT * FROM settings WHERE id = 1')).rows[0];
    const { dailyGoal, romanizationMode, soundEffects } = req.body;
    await query(
      'UPDATE settings SET daily_goal = $1, romanization_mode = $2, sound_effects = $3 WHERE id = 1',
      [
        dailyGoal !== undefined ? dailyGoal : s.daily_goal,
        romanizationMode !== undefined ? romanizationMode : s.romanization_mode,
        soundEffects !== undefined ? soundEffects : s.sound_effects,
      ]
    );
    res.json(await fullState());
  })
);

app.post(
  '/api/reset',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM lesson_progress');
    await query('DELETE FROM activity');
    await query('DELETE FROM card_reviews');
    await query('DELETE FROM cards');
    await query('UPDATE settings SET daily_goal = 20, romanization_mode = $1, sound_effects = true WHERE id = 1', [
      'peek',
    ]);
    res.json(await fullState());
  })
);

// ---------- Lesson progress ----------
app.post(
  '/api/progress',
  asyncRoute(async (req, res) => {
    const { lessonId, score, xp } = req.body;
    if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
    const gainedXp = Math.max(0, Math.min(100, Number(xp) || 0));
    const now = new Date().toISOString();
    await query(
      `INSERT INTO lesson_progress (lesson_id, completions, best_score, last_completed)
       VALUES ($1, 1, $2, $3)
       ON CONFLICT (lesson_id) DO UPDATE SET
         completions = lesson_progress.completions + 1,
         best_score = GREATEST(lesson_progress.best_score, excluded.best_score),
         last_completed = excluded.last_completed`,
      [lessonId, Math.max(0, Math.min(100, Number(score) || 0)), now]
    );
    await query(
      `INSERT INTO activity (day, xp) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET xp = activity.xp + excluded.xp`,
      [localDay(new Date()), gainedXp]
    );
    res.json({ ok: true, state: await fullState() });
  })
);

// ---------- Placement test ----------
// Marks a batch of lessons complete at once (the ones the test placed you past)
// and logs one activity entry for the whole test, rather than per-lesson XP.
app.post(
  '/api/placement',
  asyncRoute(async (req, res) => {
    const { passedLessonIds, xp } = req.body;
    if (!Array.isArray(passedLessonIds)) {
      return res.status(400).json({ error: 'passedLessonIds must be an array' });
    }
    const now = new Date().toISOString();
    for (const lessonId of passedLessonIds) {
      await query(
        `INSERT INTO lesson_progress (lesson_id, completions, best_score, last_completed)
         VALUES ($1, 1, 85, $2)
         ON CONFLICT (lesson_id) DO UPDATE SET
           completions = GREATEST(lesson_progress.completions, 1),
           best_score = GREATEST(lesson_progress.best_score, 85),
           last_completed = excluded.last_completed`,
        [lessonId, now]
      );
    }
    const gainedXp = Math.max(0, Math.min(200, Number(xp) || 0));
    if (gainedXp > 0) {
      await query(
        `INSERT INTO activity (day, xp) VALUES ($1, $2)
         ON CONFLICT (day) DO UPDATE SET xp = activity.xp + excluded.xp`,
        [localDay(new Date()), gainedXp]
      );
    }
    res.json({ ok: true, state: await fullState() });
  })
);

// ---------- My Words (personal tutor-vocab deck) ----------
app.get(
  '/api/cards',
  asyncRoute(async (req, res) => {
    const cards = (await query('SELECT * FROM cards ORDER BY id DESC')).rows;
    res.json(cards);
  })
);

app.post(
  '/api/cards',
  asyncRoute(async (req, res) => {
    const { khmer, roman, english, notes } = req.body;
    if (!khmer || !english) return res.status(400).json({ error: 'khmer and english required' });
    const { rows } = await query(
      'INSERT INTO cards (khmer, roman, english, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [khmer.trim(), (roman || '').trim(), english.trim(), (notes || '').trim()]
    );
    const card = rows[0];
    await query(
      'INSERT INTO card_reviews (card_id, box, due) VALUES ($1, 1, $2) ON CONFLICT (card_id) DO NOTHING',
      [card.id, localDay(new Date())]
    );
    res.json(card);
  })
);

app.put(
  '/api/cards/:id',
  asyncRoute(async (req, res) => {
    const c = (await query('SELECT * FROM cards WHERE id = $1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'not found' });
    const { khmer, roman, english, notes } = req.body;
    await query('UPDATE cards SET khmer = $1, roman = $2, english = $3, notes = $4 WHERE id = $5', [
      khmer !== undefined ? khmer : c.khmer,
      roman !== undefined ? roman : c.roman,
      english !== undefined ? english : c.english,
      notes !== undefined ? notes : c.notes,
      c.id,
    ]);
    const updated = (await query('SELECT * FROM cards WHERE id = $1', [c.id])).rows[0];
    res.json(updated);
  })
);

app.delete(
  '/api/cards/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM card_reviews WHERE card_id = $1', [req.params.id]);
    await query('DELETE FROM cards WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---------- Spaced repetition ----------
const BOX_INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 }; // days until next review

app.get(
  '/api/reviews/due',
  asyncRoute(async (req, res) => {
    // Ensure every card has a review row (covers cards added before card_reviews existed).
    await query(
      `INSERT INTO card_reviews (card_id, box, due)
       SELECT id, 1, $1 FROM cards
       ON CONFLICT (card_id) DO NOTHING`,
      [localDay(new Date())]
    );
    const due = (
      await query(
        `SELECT c.*, r.box, r.due FROM card_reviews r
         JOIN cards c ON c.id = r.card_id
         WHERE r.due <= $1
         ORDER BY r.due, c.id`,
        [localDay(new Date())]
      )
    ).rows;
    const total = Number((await query('SELECT COUNT(*) AS c FROM cards')).rows[0].c);
    res.json({ due, totalCards: total });
  })
);

app.post(
  '/api/reviews',
  asyncRoute(async (req, res) => {
    const { cardId, grade } = req.body; // grade: 'again' | 'good' | 'easy'
    const r = (await query('SELECT * FROM card_reviews WHERE card_id = $1', [cardId])).rows[0];
    if (!r) return res.status(404).json({ error: 'review row not found' });
    let box = r.box;
    if (grade === 'again') box = 1;
    else if (grade === 'good') box = Math.min(5, box + 1);
    else if (grade === 'easy') box = Math.min(5, box + 2);
    const next = new Date();
    next.setDate(next.getDate() + BOX_INTERVALS[box]);
    await query('UPDATE card_reviews SET box = $1, due = $2, last_reviewed = $3 WHERE card_id = $4', [
      box,
      localDay(next),
      new Date().toISOString(),
      cardId,
    ]);
    res.json({ ok: true, box });
  })
);

// ---------- Khmer audio (Google Translate TTS, cached locally) ----------
// First request per word needs internet; after that it's served from tts-cache/ forever.
// On Render's free tier this directory is ephemeral for NEW words (the course
// words ship pre-cached in the repo either way) — a cache miss just re-fetches.
const TTS_DIR = path.join(__dirname, 'tts-cache');
fs.mkdirSync(TTS_DIR, { recursive: true });

async function fetchTts(text, file) {
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=km&q=' +
    encodeURIComponent(text);
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!r.ok) throw new Error(`TTS upstream ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('TTS returned empty audio');
  fs.writeFileSync(file, buf);
}

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: 'text required' });
  const file = path.join(TTS_DIR, crypto.createHash('sha1').update(text).digest('hex') + '.mp3');
  if (!fs.existsSync(file)) {
    try {
      await fetchTts(text, file);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  fs.createReadStream(file).pipe(res);
});

migrate()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  ភាសាខ្មែរ — Khmer practice is running!\n`);
      if (process.env.RENDER) {
        console.log(`  Live at your Render URL — listening on port ${PORT}\n`);
        return;
      }
      const nets = os.networkInterfaces();
      const lan = Object.values(nets)
        .flat()
        .filter((n) => n && n.family === 'IPv4' && !n.internal)
        .map((n) => n.address);
      console.log(`  You:  http://localhost:${PORT}`);
      for (const ip of lan) console.log(`  LAN:  http://${ip}:${PORT}`);
      console.log('');
    });
  })
  .catch((e) => {
    console.error('Failed to set up the database:', e.message);
    process.exit(1);
  });
