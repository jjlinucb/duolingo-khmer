const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    '\nMissing DATABASE_URL.\n' +
      'Local dev: create a .env file (see .env.example) with your Postgres connection string.\n' +
      'Render: set the DATABASE_URL environment variable in the service dashboard.\n'
  );
  process.exit(1);
}

// Neon/Render-managed Postgres both require SSL; the built-in CA chain isn't
// always present in minimal runtime images, so we trust the connection like
// most managed-Postgres client examples do rather than fail to connect.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

function query(text, params) {
  return pool.query(text, params);
}

// Multi-user app: each learner is a row in `users`, identified by a browser
// cookie (see server.js). settings/lesson_progress/activity are all keyed by
// user_id instead of the old single implicit row.
async function migrate() {
  // One-time migration off the old single-user schema. Detect it by checking
  // whether lesson_progress already has a user_id column; if not, this is the
  // pre-multi-user shape and we drop it. This only ever fires once per
  // database — after it runs, lesson_progress has user_id and this branch is
  // skipped on every future restart, so real per-user data is never wiped.
  const { rows: legacyCheck } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lesson_progress' AND column_name = 'user_id'
  `);
  if (legacyCheck.length === 0) {
    await pool.query(`
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS lesson_progress;
      DROP TABLE IF EXISTS activity;
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_idx ON users (LOWER(name));

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_goal INTEGER NOT NULL DEFAULT 20,
      sound_effects BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL,
      completions INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      last_completed TEXT,
      PRIMARY KEY (user_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS activity (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    DROP TABLE IF EXISTS card_reviews;
    DROP TABLE IF EXISTS cards;
  `);
}

// Case-insensitive find-or-create so "Jeanine" and "jeanine" are the same
// learner. Also seeds a default settings row for brand-new users.
async function getOrCreateUser(name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('name required');

  const existing = await pool.query('SELECT id, name FROM users WHERE LOWER(name) = LOWER($1)', [
    clean,
  ]);
  if (existing.rows[0]) return existing.rows[0];

  const created = await pool.query(
    'INSERT INTO users (name) VALUES ($1) RETURNING id, name',
    [clean]
  );
  await pool.query('INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    created.rows[0].id,
  ]);
  return created.rows[0];
}

async function listUsers() {
  const { rows } = await pool.query('SELECT id, name FROM users ORDER BY LOWER(name)');
  return rows;
}

async function userExists(userId) {
  const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  return rows.length > 0;
}

module.exports = { query, migrate, pool, getOrCreateUser, listUsers, userExists };
