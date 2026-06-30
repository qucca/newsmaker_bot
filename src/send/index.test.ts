import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { GrammyError } from 'grammy';
import { runMigrations } from '../db/migrate.js';
import { getUser, createUser, getCardsSentTotal, type UserRow } from '../db/users.js';
import { createSendQueue } from './queue.js';
import { sendUserCards, isForbidden, type SendDeps } from './index.js';
import type { UserCard } from '../card/index.js';
import type { CardMessage } from '../card/compose.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedUser(db: Database.Database, chatId: number): UserRow {
  createUser(
    db,
    {
      chatId, lang: 'en', tz: 'UTC', interestTags: [], profileText: '',
      readingWindows: [], maxItemsPerSend: 5,
    },
    0,
  );
  return getUser(db, chatId) as UserRow;
}

function seedCluster(db: Database.Database): number {
  const info = db
    .prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 0, 0)`)
    .run();
  return Number(info.lastInsertRowid);
}

const msg = (): CardMessage => ({ text: 'x', parseMode: 'HTML', disableWebPagePreview: false });

function deps(db: Database.Database, send: SendDeps['send']): SendDeps {
  // Виртуальные часы внутри очереди не важны для этих тестов (sleep мгновенный).
  const queue = createSendQueue({ globalRps: 1000, perChatRps: 1000, now: () => 0, sleep: () => Promise.resolve() });
  return { db, queue, send, now: () => 999, logger: { info() {}, warn() {}, error() {} } };
}

/** Помощник: собрать GrammyError с заданным error_code. */
function grammyError(code: number, description: string): GrammyError {
  // GrammyError(message, err, method, payload): err — объект ответа Telegram.
  return new GrammyError(
    `Call to 'sendMessage' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    'sendMessage',
    {},
  );
}

test('sendUserCards: успех → строка в sent_log (kind=digest), sent=1', async () => {
  const db = memDb();
  const user = seedUser(db, 1);
  const cl = seedCluster(db);
  const cards: UserCard[] = [{ clusterId: cl, message: msg() }];

  const summary = await sendUserCards(deps(db, () => Promise.resolve({ ok: true })), user, cards);

  assert.deepEqual(summary, { sent: 1, skipped: 0, deactivated: false });
  const row = db.prepare(`SELECT kind AS k, sent_at AS s FROM sent_log WHERE cluster_id = ?`).get(cl);
  assert.deepEqual(row, { k: 'digest', s: 999 });
});

test('sendUserCards: lifetime-счётчик растёт на новую карточку, не на дедуп', async () => {
  const db = memDb();
  const user = seedUser(db, 1);
  const cards: UserCard[] = [
    { clusterId: seedCluster(db), message: msg() },
    { clusterId: seedCluster(db), message: msg() },
  ];

  await sendUserCards(deps(db, () => Promise.resolve({ ok: true })), user, cards);
  assert.equal(getCardsSentTotal(db, 1), 2);

  // Повторная отправка тех же кластеров — дедуп в sent_log, счётчик НЕ растёт.
  await sendUserCards(deps(db, () => Promise.resolve({ ok: true })), user, cards);
  assert.equal(getCardsSentTotal(db, 1), 2);
});

test('sendUserCards: 403 → active=0, deactivated, оставшиеся карточки не шлются', async () => {
  const db = memDb();
  const user = seedUser(db, 1);
  const cl1 = seedCluster(db);
  const cl2 = seedCluster(db);
  const cards: UserCard[] = [
    { clusterId: cl1, message: msg() },
    { clusterId: cl2, message: msg() },
  ];
  let calls = 0;
  const send = (): Promise<unknown> => {
    calls++;
    return Promise.reject(grammyError(403, 'Forbidden: bot was blocked by the user'));
  };

  const summary = await sendUserCards(deps(db, send), user, cards);

  assert.equal(summary.deactivated, true);
  assert.equal(summary.sent, 0);
  assert.equal(calls, 1); // вторая карточка не отправлялась (break)
  assert.equal(getUser(db, 1)?.active, 0);
  const cnt = db.prepare(`SELECT COUNT(*) AS n FROM sent_log`).get() as { n: number };
  assert.equal(cnt.n, 0); // sent_log при 403 не пишем
});

test('sendUserCards: 400 → skip+log, sent_log пуст, следующая карточка уходит', async () => {
  const db = memDb();
  const user = seedUser(db, 1);
  const cl1 = seedCluster(db);
  const cl2 = seedCluster(db);
  const cards: UserCard[] = [
    { clusterId: cl1, message: msg() },
    { clusterId: cl2, message: msg() },
  ];
  let calls = 0;
  const send = (): Promise<unknown> => {
    calls++;
    if (calls === 1) return Promise.reject(grammyError(400, 'Bad Request: message is too long'));
    return Promise.resolve({ ok: true });
  };

  const summary = await sendUserCards(deps(db, send), user, cards);

  assert.deepEqual(summary, { sent: 1, skipped: 1, deactivated: false });
  const rows = db.prepare(`SELECT cluster_id AS cl FROM sent_log`).all() as { cl: number }[];
  assert.deepEqual(rows, [{ cl: cl2 }]); // только вторая карточка зафиксирована
});

test('isForbidden: true только для GrammyError с error_code 403', () => {
  assert.equal(isForbidden(grammyError(403, 'x')), true);
  assert.equal(isForbidden(grammyError(400, 'x')), false);
  assert.equal(isForbidden(new Error('net')), false);
});
