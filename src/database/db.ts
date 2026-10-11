import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    migrate(db);
    logger.info(`SQLite ready at ${config.dbPath}`);
  } catch (error) {
    logger.error("Failed to initialize database", error instanceof Error ? error.message : error);
    throw error;
  }
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      telegram_username TEXT,
      telegram_full_name TEXT,
      poster_file_path TEXT NOT NULL,
      poster_file_id TEXT NOT NULL,
      user_text TEXT,
      extracted_info TEXT,
      generated_caption TEXT,
      final_caption TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      published_at TEXT,
      telegram_publish_status TEXT NOT NULL DEFAULT 'pending',
      whatsapp_publish_status TEXT NOT NULL DEFAULT 'pending',
      telegram_message_id TEXT,
      error_message TEXT
    );
  `);

  const columns = database
    .prepare(`PRAGMA table_info(submissions)`)
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("source")) {
    database.exec(`ALTER TABLE submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'telegram'`);
  }
  if (!names.has("whatsapp_sender")) {
    database.exec(`ALTER TABLE submissions ADD COLUMN whatsapp_sender TEXT`);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
