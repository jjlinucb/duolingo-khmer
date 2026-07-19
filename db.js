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

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '🙂',
      weekly_goal INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id INTEGER NOT NULL REFERENCES users(id),
      lesson_id TEXT NOT NULL,
      completions INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      last_completed TEXT,
      PRIMARY KEY (user_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS activity (
      user_id INTEGER NOT NULL REFERENCES users(id),
      day TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      khmer TEXT NOT NULL,
      roman TEXT NOT NULL DEFAULT '',
      english TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS card_reviews (
      user_id INTEGER NOT NULL REFERENCES users(id),
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      box INTEGER NOT NULL DEFAULT 1,
      due TEXT NOT NULL,
      last_reviewed TEXT,
      PRIMARY KEY (user_id, card_id)
    );
  `);
}

module.exports = { query, migrate, pool };
