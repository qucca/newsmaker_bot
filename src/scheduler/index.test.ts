import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../log/index.js';
import type { UserRow } from '../db/users.js';
import { runGlobalPass, runDispatchTick, guardedRunner } from './index.js';

const silent: Logger = { info() {}, warn() {}, error() {} };

function mkUser(over: Partial<UserRow>): UserRow {
  return {
    chatId: 1,
    lang: 'ru',
    tz: 'UTC',
    interestTags: [],
    profileText: '',
    readingWindows: ['08:00', '13:00', '19:00', '22:00'],
    maxItemsPerSend: 5,
    active: 1,
    lastSentAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const NOW = Date.UTC(2026, 5, 28, 14, 5); // 14:05 UTC → последняя граница 13:00
const B13 = Date.UTC(2026, 5, 28, 13, 0);

// ── runGlobalPass ──────────────────────────────────────────────────────────

test('runGlobalPass: вызывает collect→enrich→cluster по порядку', async () => {
  const calls: string[] = [];
  await runGlobalPass({
    logger: silent,
    collect: async () => void calls.push('collect'),
    enrich: async () => void calls.push('enrich'),
    cluster: async () => void calls.push('cluster'),
  });
  assert.deepEqual(calls, ['collect', 'enrich', 'cluster']);
});

test('runGlobalPass: сбой шага изолируется, следующие шаги выполняются', async () => {
  const calls: string[] = [];
  await runGlobalPass({
    logger: silent,
    collect: async () => {
      throw new Error('rss down');
    },
    enrich: async () => void calls.push('enrich'),
    cluster: async () => void calls.push('cluster'),
  });
  assert.deepEqual(calls, ['enrich', 'cluster']);
});

// ── runDispatchTick ────────────────────────────────────────────────────────

test('runDispatchTick: due-юзер обработан, окно закрыто на границе', async () => {
  const processed: number[] = [];
  const served: Array<[number, number]> = [];
  const res = await runDispatchTick({
    now: () => NOW,
    logger: silent,
    listActiveUsers: () => [mkUser({ chatId: 1, lastSentAt: null })],
    processUser: async (u) => void processed.push(u.chatId),
    markWindowServed: (id, b) => void served.push([id, b]),
  });
  assert.deepEqual(processed, [1]);
  assert.deepEqual(served, [[1, B13]]);
  assert.deepEqual(res, { considered: 1, due: 1 });
});

test('runDispatchTick: окно уже обслужено (last_sent >= граница) → пропуск', async () => {
  const processed: number[] = [];
  const served: number[] = [];
  const res = await runDispatchTick({
    now: () => NOW,
    logger: silent,
    listActiveUsers: () => [mkUser({ chatId: 2, lastSentAt: B13 })],
    processUser: async (u) => void processed.push(u.chatId),
    markWindowServed: (id) => void served.push(id),
  });
  assert.deepEqual(processed, []);
  assert.deepEqual(served, []);
  assert.deepEqual(res, { considered: 1, due: 0 });
});

test('runDispatchTick: вне окна (сегодня ни одна граница не наступила) → пропуск', async () => {
  const early = Date.UTC(2026, 5, 28, 7, 30);
  const processed: number[] = [];
  const res = await runDispatchTick({
    now: () => early,
    logger: silent,
    listActiveUsers: () => [mkUser({ chatId: 3, lastSentAt: null })],
    processUser: async (u) => void processed.push(u.chatId),
    markWindowServed: () => {},
  });
  assert.deepEqual(processed, []);
  assert.deepEqual(res, { considered: 1, due: 0 });
});

test('runDispatchTick: сбой обработки юзера изолируется, окно всё равно закрывается', async () => {
  const served: Array<[number, number]> = [];
  const res = await runDispatchTick({
    now: () => NOW,
    logger: silent,
    listActiveUsers: () => [mkUser({ chatId: 4, lastSentAt: null })],
    processUser: async () => {
      throw new Error('render boom');
    },
    markWindowServed: (id, b) => void served.push([id, b]),
  });
  assert.deepEqual(served, [[4, B13]]);
  assert.deepEqual(res, { considered: 1, due: 1 });
});

test('runDispatchTick: несколько юзеров — обрабатываются только due', async () => {
  const processed: number[] = [];
  const served: number[] = [];
  const res = await runDispatchTick({
    now: () => NOW,
    logger: silent,
    listActiveUsers: () => [
      mkUser({ chatId: 1, lastSentAt: null }), // due (новый)
      mkUser({ chatId: 2, lastSentAt: B13 }), // обслужено
      mkUser({ chatId: 3, lastSentAt: Date.UTC(2026, 5, 28, 9, 0) }), // last < 13:00 → due
      mkUser({ chatId: 4, readingWindows: [], lastSentAt: null }), // нет окон → пропуск
    ],
    processUser: async (u) => void processed.push(u.chatId),
    markWindowServed: (id) => void served.push(id),
  });
  assert.deepEqual(
    processed.sort((a, b) => a - b),
    [1, 3],
  );
  assert.deepEqual(
    served.sort((a, b) => a - b),
    [1, 3],
  );
  assert.deepEqual(res, { considered: 4, due: 2 });
});

// ── guardedRunner ──────────────────────────────────────────────────────────

test('guardedRunner: повторный вызов во время выполнения пропускается', async () => {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const run = guardedRunner(
    async () => {
      started++;
      await gate;
    },
    silent,
    'x',
  );
  const p1 = run(); // стартует, висит на gate
  await run(); // running → пропуск
  assert.equal(started, 1);
  release();
  await p1;
  await run(); // снова свободно
  assert.equal(started, 2);
});

test('guardedRunner: сбой задачи не оставляет залипший флаг', async () => {
  let started = 0;
  const run = guardedRunner(
    async () => {
      started++;
      throw new Error('boom');
    },
    silent,
    'x',
  );
  await run();
  await run();
  assert.equal(started, 2);
});
