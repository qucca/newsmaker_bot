import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { createBot } from './index.js';

// Смоук-тест сборки бота: createBot не должен бросать при конструировании
// (регистрация всех хендлеров + autoRetry middleware), .start() НЕ вызываем (без сети).
test('createBot: собирается без ошибок и возвращает рабочий Bot', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const bot = createBot('123:FAKE', { db, now: () => 0 }, 100);

  assert.ok(bot);
  assert.equal(typeof bot.handleUpdate, 'function');

  db.close();
});
