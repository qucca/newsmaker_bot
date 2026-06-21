import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { getDatabasePath } from '../config/index.js';
import { openDb } from './connection.js';

// Каталог миграций относительно этого модуля — работает и в dev (tsx), и в dist (node).
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Применяет ещё не применённые миграции из migrations/*.sql по порядку (лексикографически),
 * каждую — в транзакции, фиксируя версию в служебной таблице schema_migrations.
 * Возвращает список применённых в этом запуске файлов.
 */
export function runMigrations(db: Database.Database): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT    PRIMARY KEY,
       applied_at INTEGER NOT NULL
     ) STRICT;`,
  );

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (row) => row.version,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const apply = db.transaction((version: string, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      Date.now(),
    );
  });

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    apply(file, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    newlyApplied.push(file);
  }
  return newlyApplied;
}

// CLI: `npm run migrate`. Нужен только путь к БД (не секреты) — отдельный резолвер из config.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  const db = openDb(getDatabasePath());
  const applied = runMigrations(db);
  if (applied.length === 0) {
    console.log('migrate: новых миграций нет, схема актуальна');
  } else {
    console.log('migrate: применены миграции:', applied.join(', '));
  }
  db.close();
}
