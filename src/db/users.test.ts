import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createUser,
  getUser,
  updateUserFields,
  deleteUser,
  countActiveUsers,
  setUserInactive,
  selectActiveUsers,
  setLastSent,
  type NewUser,
} from './users.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const base: NewUser = {
  chatId: 42,
  lang: 'ru',
  tz: 'Europe/Moscow',
  interestTags: ['football', 'ai'],
  profileText: 'SpaceX',
  readingWindows: ['08:00', '19:00'],
  maxItemsPerSend: 5,
};

test('createUser + getUser: round-trip полей и JSON', () => {
  const db = memDb();
  createUser(db, base, 1000);
  const u = getUser(db, 42);
  assert.ok(u);
  assert.equal(u.lang, 'ru');
  assert.equal(u.tz, 'Europe/Moscow');
  assert.deepEqual(u.interestTags, ['football', 'ai']);
  assert.equal(u.profileText, 'SpaceX');
  assert.deepEqual(u.readingWindows, ['08:00', '19:00']);
  assert.equal(u.maxItemsPerSend, 5);
  assert.equal(u.active, 1);
  assert.equal(u.lastSentAt, null);
  assert.equal(u.createdAt, 1000);
  assert.equal(u.updatedAt, 1000);
  db.close();
});

test('getUser: неизвестный chatId -> undefined', () => {
  const db = memDb();
  assert.equal(getUser(db, 999), undefined);
  db.close();
});

test('getUser: мягкое чтение interest_tags отбрасывает неизвестные слаги', () => {
  const db = memDb();
  createUser(db, base, 1000);
  // подсунем висячий слаг напрямую в БД
  db.prepare(`UPDATE users SET interest_tags = ? WHERE chat_id = 42`).run(
    JSON.stringify(['football', 'obsolete_tag', 'ai']),
  );
  const u = getUser(db, 42);
  assert.deepEqual(u?.interestTags, ['football', 'ai']);
  db.close();
});

test('updateUserFields: патчит только переданные поля + updated_at', () => {
  const db = memDb();
  createUser(db, base, 1000);
  updateUserFields(db, 42, { maxItemsPerSend: 10, tz: 'UTC' }, 2000);
  const u = getUser(db, 42);
  assert.equal(u?.maxItemsPerSend, 10);
  assert.equal(u?.tz, 'UTC');
  assert.equal(u?.lang, 'ru'); // не тронуто
  assert.equal(u?.createdAt, 1000);
  assert.equal(u?.updatedAt, 2000);
  db.close();
});

test('countActiveUsers считает active=1', () => {
  const db = memDb();
  createUser(db, base, 1000);
  createUser(db, { ...base, chatId: 43 }, 1000);
  db.prepare(`UPDATE users SET active = 0 WHERE chat_id = 43`).run();
  assert.equal(countActiveUsers(db), 1);
  db.close();
});

test('deleteUser удаляет строку (+CASCADE feedback)', () => {
  const db = memDb();
  createUser(db, base, 1000);
  db.prepare(
    `INSERT INTO feedback (chat_id, cluster_id, vote, source, created_at) VALUES (42, NULL, 1, 'x.com', 1)`,
  ).run();
  deleteUser(db, 42);
  assert.equal(getUser(db, 42), undefined);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE chat_id = 42`).get() as { n: number }).n,
    0,
  );
  db.close();
});

test('setUserInactive: ставит active=0 и обновляет updated_at', () => {
  const db = memDb();
  createUser(
    db,
    {
      chatId: 7,
      lang: 'en',
      tz: 'UTC',
      interestTags: [],
      profileText: '',
      readingWindows: [],
      maxItemsPerSend: 5,
    },
    1000,
  );

  setUserInactive(db, 7, 5000);

  const u = getUser(db, 7);
  assert.equal(u?.active, 0);
  assert.equal(u?.updatedAt, 5000);
  db.close();
});

test('selectActiveUsers: только active=1, с теми же полями, что getUser', () => {
  const db = memDb();
  createUser(db, base, 1000); // chat 42, active
  createUser(db, { ...base, chatId: 43 }, 1000);
  createUser(db, { ...base, chatId: 44 }, 1000);
  db.prepare(`UPDATE users SET active = 0 WHERE chat_id = 43`).run();

  const users = selectActiveUsers(db);
  assert.deepEqual(
    users.map((u) => u.chatId).sort((a, b) => a - b),
    [42, 44],
  );
  const u42 = users.find((u) => u.chatId === 42);
  assert.deepEqual(u42?.readingWindows, ['08:00', '19:00']);
  assert.deepEqual(u42?.interestTags, ['football', 'ai']);
  assert.equal(u42?.tz, 'Europe/Moscow');
  db.close();
});

test('selectActiveUsers: пусто, когда активных нет', () => {
  const db = memDb();
  createUser(db, base, 1000);
  setUserInactive(db, 42, 2000);
  assert.deepEqual(selectActiveUsers(db), []);
  db.close();
});

test('setLastSent: двигает last_sent_at, не трогает updated_at', () => {
  const db = memDb();
  createUser(db, base, 1000);
  setLastSent(db, 42, 1717000000000);
  const u = getUser(db, 42);
  assert.equal(u?.lastSentAt, 1717000000000);
  assert.equal(u?.updatedAt, 1000); // last_sent_at — состояние расписания, не правка профиля
  db.close();
});
