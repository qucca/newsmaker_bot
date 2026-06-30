import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { incrementCardsSent, getCardsSentTotal } from './users.js';

// Lifetime-счётчик отправленных карточек (users.cards_sent_total): гейт калибровки (T14)
// читает его вместо COUNT(sent_log), чтобы ретенция sent_log не «оживляла» кнопки.

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedUser(db: Database.Database, chatId: number): void {
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (?, 'en', 'UTC', 5, 0, 0)`,
  ).run(chatId);
}

test('getCardsSentTotal: 0 у нового юзера', () => {
  const db = memDb();
  seedUser(db, 1);
  assert.equal(getCardsSentTotal(db, 1), 0);
});

test('incrementCardsSent: +1 за вызов, изолированно по chat_id', () => {
  const db = memDb();
  seedUser(db, 1);
  seedUser(db, 2);

  incrementCardsSent(db, 1);
  incrementCardsSent(db, 1);
  incrementCardsSent(db, 2);

  assert.equal(getCardsSentTotal(db, 1), 2);
  assert.equal(getCardsSentTotal(db, 2), 1);
});

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

function execMigration(db: Database.Database, file: string): void {
  db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
}

test('миграция 0004: бэкофилл cards_sent_total из существующего sent_log', () => {
  // Применяем схему ДО 0004, сеем юзера с 3 отправленными кластерами, затем 0004.
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  execMigration(db, '0001_init.sql');
  execMigration(db, '0002_articles_description.sql');
  execMigration(db, '0003_cluster_key_firstseen_index.sql');

  seedUser(db, 7);
  for (let i = 1; i <= 3; i++) {
    db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 0, 0)`).run();
    db.prepare(`INSERT INTO sent_log (chat_id, cluster_id, kind, sent_at) VALUES (7, ?, 'digest', 0)`).run(i);
  }

  execMigration(db, '0004_cards_sent_total.sql');

  assert.equal(getCardsSentTotal(db, 7), 3);
});
