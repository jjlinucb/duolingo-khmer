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

// Single-user app: one implicit settings row (id = 1), no accounts.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      daily_goal INTEGER NOT NULL DEFAULT 20,
      romanization_mode TEXT NOT NULL DEFAULT 'peek',
      sound_effects BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT single_row CHECK (id = 1)
    );
    INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS lesson_progress (
      lesson_id TEXT PRIMARY KEY,
      completions INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      last_completed TEXT
    );

    CREATE TABLE IF NOT EXISTS activity (
      day TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      khmer TEXT NOT NULL,
      roman TEXT NOT NULL DEFAULT '',
      english TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS card_reviews (
      card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      box INTEGER NOT NULL DEFAULT 1,
      due TEXT NOT NULL,
      last_reviewed TEXT
    );
  `);
}

module.exports = { query, migrate, pool };
