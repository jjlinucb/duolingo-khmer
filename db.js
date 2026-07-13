const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'khmer.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🙂',
  weekly_goal INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  khmer TEXT NOT NULL,
  roman TEXT NOT NULL DEFAULT '',
  english TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

module.exports = db;
