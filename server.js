require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query, migrate, getOrCreateUser, listUsers, userExists } = require('./db');

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

async function computeStreak(userId) {
  const { rows } = await query(
    'SELECT day FROM activity WHERE user_id = $1 AND xp > 0 ORDER BY day DESC LIMIT 400',
    [userId]
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

// ---------- Session cookies (no login, just a per-browser profile pointer) ----------
// No new dependency for this — cookies here are a single opaque user id, not
// worth pulling in cookie-parser for.
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function setUserCookie(req, res, userId) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const maxAgeSeconds = 400 * 24 * 60 * 60; // 400 days — the practical browser cap
  res.setHeader(
    'Set-Cookie',
    `uid=${encodeURIComponent(userId)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${
      secure ? '; Secure' : ''
    }`
  );
}

function clearUserCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `uid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

// Attaches req.userId from the uid cookie, or 401s with a code the frontend
// recognizes as "show the profile picker" rather than a generic error.
function requireUser(req, res, next) {
  const raw = parseCookies(req).uid;
  const userId = raw ? parseInt(raw, 10) : NaN;
  if (!userId) return res.status(401).json({ error: 'no-session', code: 'no-session' });
  userExists(userId)
    .then((exists) => {
      if (!exists) {
        clearUserCookie(req, res);
        return res.status(401).json({ error: 'no-session', code: 'no-session' });
      }
      req.userId = userId;
      next();
    })
    .catch((e) => {
      console.error(e);
      res.status(500).json({ error: e.message });
    });
}

async function fullState(userId) {
  const userRow = (await query('SELECT name FROM users WHERE id = $1', [userId])).rows[0];
  const settings = (await query('SELECT * FROM settings WHERE user_id = $1', [userId])).rows[0];
  const week = weekDays();
  const weekRows = (
    await query('SELECT day, xp FROM activity WHERE user_id = $1 AND day = ANY($2::text[])', [
      userId,
      week,
    ])
  ).rows;
  const byDay = Object.fromEntries(weekRows.map((r) => [r.day, r.xp]));
  const weekXp = week.map((day) => ({ day, xp: byDay[day] || 0 }));
  const todayRow = (
    await query('SELECT xp FROM activity WHERE user_id = $1 AND day = $2', [
      userId,
      localDay(new Date()),
    ])
  ).rows[0];
  const totalXp = (
    await query('SELECT COALESCE(SUM(xp),0) AS t FROM activity WHERE user_id = $1', [userId])
  ).rows[0].t;
  const progressRows = (
    await query('SELECT lesson_id, completions, best_score FROM lesson_progress WHERE user_id = $1', [
      userId,
    ])
  ).rows;
  const progress = {};
  for (const r of progressRows) {
    progress[r.lesson_id] = { completions: r.completions, bestScore: r.best_score };
  }
  const lessonsDone = progressRows.filter(
    (r) => r.completions > 0 && r.lesson_id !== 'review' && r.lesson_id !== 'practice'
  ).length;
  return {
    userName: userRow ? userRow.name : null,
    settings: {
      dailyGoal: settings.daily_goal,
      soundEffects: settings.sound_effects,
    },
    streak: await computeStreak(userId),
    todayXp: todayRow ? Number(todayRow.xp) : 0,
    weekXp,
    weekTotal: weekXp.reduce((s, d) => s + d.xp, 0),
    totalXp: Number(totalXp),
    lessonsDone,
    progress,
  };
}

// ---------- Profiles (no password — pick or create a name) ----------
app.get(
  '/api/users',
  asyncRoute(async (req, res) => {
    res.json(await listUsers());
  })
);

app.post(
  '/api/session',
  asyncRoute(async (req, res) => {
    const user = await getOrCreateUser(req.body.name);
    setUserCookie(req, res, user.id);
    res.json({ user, state: await fullState(user.id) });
  })
);

app.post('/api/logout', (req, res) => {
  clearUserCookie(req, res);
  res.json({ ok: true });
});

// ---------- App state ----------
app.get(
  '/api/state',
  requireUser,
  asyncRoute(async (req, res) => {
    res.json(await fullState(req.userId));
  })
);

app.put(
  '/api/settings',
  requireUser,
  asyncRoute(async (req, res) => {
    const s = (await query('SELECT * FROM settings WHERE user_id = $1', [req.userId])).rows[0];
    const { dailyGoal, soundEffects } = req.body;
    await query('UPDATE settings SET daily_goal = $1, sound_effects = $2 WHERE user_id = $3', [
      dailyGoal !== undefined ? dailyGoal : s.daily_goal,
      soundEffects !== undefined ? soundEffects : s.sound_effects,
      req.userId,
    ]);
    res.json(await fullState(req.userId));
  })
);

app.post(
  '/api/reset',
  requireUser,
  asyncRoute(async (req, res) => {
    await query('DELETE FROM lesson_progress WHERE user_id = $1', [req.userId]);
    await query('DELETE FROM activity WHERE user_id = $1', [req.userId]);
    await query('UPDATE settings SET daily_goal = 20, sound_effects = true WHERE user_id = $1', [
      req.userId,
    ]);
    res.json(await fullState(req.userId));
  })
);

// ---------- Lesson progress ----------
app.post(
  '/api/progress',
  requireUser,
  asyncRoute(async (req, res) => {
    const { lessonId, score, xp } = req.body;
    if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
    const gainedXp = Math.max(0, Math.min(100, Number(xp) || 0));
    const now = new Date().toISOString();
    await query(
      `INSERT INTO lesson_progress (user_id, lesson_id, completions, best_score, last_completed)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET
         completions = lesson_progress.completions + 1,
         best_score = GREATEST(lesson_progress.best_score, excluded.best_score),
         last_completed = excluded.last_completed`,
      [req.userId, lessonId, Math.max(0, Math.min(100, Number(score) || 0)), now]
    );
    await query(
      `INSERT INTO activity (user_id, day, xp) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, day) DO UPDATE SET xp = activity.xp + excluded.xp`,
      [req.userId, localDay(new Date()), gainedXp]
    );
    res.json({ ok: true, state: await fullState(req.userId) });
  })
);

// ---------- Placement test ----------
// Marks a batch of lessons complete at once (the ones the test placed you past)
// and logs one activity entry for the whole test, rather than per-lesson XP.
app.post(
  '/api/placement',
  requireUser,
  asyncRoute(async (req, res) => {
    const { passedLessonIds, xp } = req.body;
    if (!Array.isArray(passedLessonIds)) {
      return res.status(400).json({ error: 'passedLessonIds must be an array' });
    }
    const now = new Date().toISOString();
    for (const lessonId of passedLessonIds) {
      await query(
        `INSERT INTO lesson_progress (user_id, lesson_id, completions, best_score, last_completed)
         VALUES ($1, $2, 1, 85, $3)
         ON CONFLICT (user_id, lesson_id) DO UPDATE SET
           completions = GREATEST(lesson_progress.completions, 1),
           best_score = GREATEST(lesson_progress.best_score, 85),
           last_completed = excluded.last_completed`,
        [req.userId, lessonId, now]
      );
    }
    const gainedXp = Math.max(0, Math.min(200, Number(xp) || 0));
    if (gainedXp > 0) {
      await query(
        `INSERT INTO activity (user_id, day, xp) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, day) DO UPDATE SET xp = activity.xp + excluded.xp`,
        [req.userId, localDay(new Date()), gainedXp]
      );
    }
    res.json({ ok: true, state: await fullState(req.userId) });
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
