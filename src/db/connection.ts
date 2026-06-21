import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { getConfig } from '../config/index.js';

/**
 * Открывает соединение с SQLite и выставляет PRAGMA уровня соединения.
 * Создаёт каталог под файл БД, если его нет.
 */
export function openDb(path: string): Database.Database {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // конкурентное чтение во время рассылки
  db.pragma('foreign_keys = ON'); // включается на каждое соединение
  db.pragma('busy_timeout = 5000'); // не падать сразу при коротких блокировках
  db.pragma('synchronous = NORMAL'); // безопасно в режиме WAL
  return db;
}

let db: Database.Database | undefined;

/** Единый инстанс БД на процесс (CLAUDE.md: один better-sqlite3 на процесс). */
export function getDb(): Database.Database {
  if (db === undefined) {
    db = openDb(getConfig().DATABASE_PATH);
  }
  return db;
}
