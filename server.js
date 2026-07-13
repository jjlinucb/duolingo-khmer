const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');

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

function computeStreak(userId) {
  const rows = db
    .prepare('SELECT day FROM activity WHERE user_id = ? AND xp > 0 ORDER BY day DESC LIMIT 400')
    .all(userId)
    .map((r) => r.day);
  const days = new Set(rows);
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

function userSummary(u) {
  const week = weekDays();
  const placeholders = week.map(() => '?').join(',');
  const weekRows = db
    .prepare(`SELECT day, xp FROM activity WHERE user_id = ? AND day IN (${placeholders})`)
    .all(u.id, ...week);
  const byDay = Object.fromEntries(weekRows.map((r) => [r.day, r.xp]));
  const weekXp = week.map((day) => ({ day, xp: byDay[day] || 0 }));
  const todayRow = db
    .prepare('SELECT xp FROM activity WHERE user_id = ? AND day = ?')
    .get(u.id, localDay(new Date()));
  const totalXp = db.prepare('SELECT COALESCE(SUM(xp),0) AS t FROM activity WHERE user_id = ?').get(u.id).t;
  const lessonsDone = db
    .prepare(
      "SELECT COUNT(*) AS c FROM lesson_progress WHERE user_id = ? AND completions > 0 AND lesson_id != 'review'"
    )
    .get(u.id).c;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    weeklyGoal: u.weekly_goal,
    streak: computeStreak(u.id),
    todayXp: todayRow ? todayRow.xp : 0,
    weekXp,
    weekTotal: weekXp.reduce((s, d) => s + d.xp, 0),
    totalXp,
    lessonsDone,
  };
}

// ---------- Users ----------
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json(users.map(userSummary));
});

app.post('/api/users', (req, res) => {
  const { name, avatar } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO users (name, avatar) VALUES (?, ?)')
    .run(name.trim(), avatar || '🙂');
  res.json(userSummary(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
});

app.put('/api/users/:id', (req, res) => {
  const { name, avatar, weeklyGoal } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE users SET name = ?, avatar = ?, weekly_goal = ? WHERE id = ?').run(
    name !== undefined ? name : u.name,
    avatar !== undefined ? avatar : u.avatar,
    weeklyGoal !== undefined ? weeklyGoal : u.weekly_goal,
    u.id
  );
  res.json(userSummary(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

// ---------- Lesson progress ----------
app.get('/api/progress/:userId', (req, res) => {
  const rows = db
    .prepare('SELECT lesson_id, completions, best_score FROM lesson_progress WHERE user_id = ?')
    .all(req.params.userId);
  const map = {};
  for (const r of rows) map[r.lesson_id] = { completions: r.completions, bestScore: r.best_score };
  res.json(map);
});

app.post('/api/progress', (req, res) => {
  const { userId, lessonId, score, xp } = req.body;
  if (!userId || !lessonId) return res.status(400).json({ error: 'userId and lessonId required' });
  const gainedXp = Math.max(0, Math.min(100, Number(xp) || 0));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO lesson_progress (user_id, lesson_id, completions, best_score, last_completed)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(user_id, lesson_id) DO UPDATE SET
       completions = completions + 1,
       best_score = MAX(best_score, excluded.best_score),
       last_completed = excluded.last_completed`
  ).run(userId, lessonId, Math.max(0, Math.min(100, Number(score) || 0)), now);
  db.prepare(
    `INSERT INTO activity (user_id, day, xp) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET xp = xp + excluded.xp`
  ).run(userId, localDay(new Date()), gainedXp);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.json({ ok: true, user: userSummary(u) });
});

// ---------- Shared cards ("Our Words") ----------
app.get('/api/cards', (req, res) => {
  const cards = db
    .prepare(
      `SELECT c.*, u.name AS created_by_name FROM cards c
       LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC`
    )
    .all();
  res.json(cards);
});

app.post('/api/cards', (req, res) => {
  const { khmer, roman, english, notes, createdBy } = req.body;
  if (!khmer || !english) return res.status(400).json({ error: 'khmer and english required' });
  const info = db
    .prepare('INSERT INTO cards (khmer, roman, english, notes, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(khmer.trim(), (roman || '').trim(), english.trim(), (notes || '').trim(), createdBy || null);
  // New card becomes due immediately for every user.
  const users = db.prepare('SELECT id FROM users').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO card_reviews (user_id, card_id, box, due) VALUES (?, ?, 1, ?)'
  );
  for (const u of users) ins.run(u.id, info.lastInsertRowid, localDay(new Date()));
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/cards/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { khmer, roman, english, notes } = req.body;
  db.prepare('UPDATE cards SET khmer = ?, roman = ?, english = ?, notes = ? WHERE id = ?').run(
    khmer !== undefined ? khmer : c.khmer,
    roman !== undefined ? roman : c.roman,
    english !== undefined ? english : c.english,
    notes !== undefined ? notes : c.notes,
    c.id
  );
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(c.id));
});

app.delete('/api/cards/:id', (req, res) => {
  db.prepare('DELETE FROM card_reviews WHERE card_id = ?').run(req.params.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Spaced repetition ----------
const BOX_INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 }; // days until next review

app.get('/api/reviews/:userId/due', (req, res) => {
  const userId = req.params.userId;
  // Ensure the user has a review row for every card (covers cards added before the user existed).
  db.prepare(
    `INSERT OR IGNORE INTO card_reviews (user_id, card_id, box, due)
     SELECT ?, id, 1, ? FROM cards`
  ).run(userId, localDay(new Date()));
  const due = db
    .prepare(
      `SELECT c.*, r.box, r.due FROM card_reviews r
       JOIN cards c ON c.id = r.card_id
       WHERE r.user_id = ? AND r.due <= ?
       ORDER BY r.due, c.id`
    )
    .all(userId, localDay(new Date()));
  const total = db.prepare('SELECT COUNT(*) AS c FROM cards').get().c;
  res.json({ due, totalCards: total });
});

app.post('/api/reviews', (req, res) => {
  const { userId, cardId, grade } = req.body; // grade: 'again' | 'good' | 'easy'
  const r = db
    .prepare('SELECT * FROM card_reviews WHERE user_id = ? AND card_id = ?')
    .get(userId, cardId);
  if (!r) return res.status(404).json({ error: 'review row not found' });
  let box = r.box;
  if (grade === 'again') box = 1;
  else if (grade === 'good') box = Math.min(5, box + 1);
  else if (grade === 'easy') box = Math.min(5, box + 2);
  const next = new Date();
  next.setDate(next.getDate() + BOX_INTERVALS[box]);
  db.prepare(
    'UPDATE card_reviews SET box = ?, due = ?, last_reviewed = ? WHERE user_id = ? AND card_id = ?'
  ).run(box, localDay(next), new Date().toISOString(), userId, cardId);
  res.json({ ok: true, box });
});

// ---------- Khmer audio (Google Translate TTS, cached locally) ----------
// First request per word needs internet; after that it's served from tts-cache/ forever.
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

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`\n  ភាសាខ្មែរ — Khmer practice is running!\n`);
  console.log(`  You:       http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Your wife: http://${ip}:${PORT}  (same wifi)`);
  console.log('');
});
