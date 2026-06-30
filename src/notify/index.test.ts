import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../log/index.js';
import { createAdminNotifier, createFailureAlerter } from './index.js';

const silent: Logger = { info() {}, warn() {}, error() {} };

// ── createAdminNotifier ──────────────────────────────────────────────────────

test('createAdminNotifier: chat не задан → send не вызывается (алерты выключены)', async () => {
  let calls = 0;
  const notify = createAdminNotifier({
    adminChatId: undefined,
    send: async () => void calls++,
    logger: silent,
  });
  await notify('hi');
  assert.equal(calls, 0);
});

test('createAdminNotifier: chat задан → send(chatId, text)', async () => {
  const got: Array<[number, string]> = [];
  const notify = createAdminNotifier({
    adminChatId: 42,
    send: async (id, text) => void got.push([id, text]),
    logger: silent,
  });
  await notify('alert!');
  assert.deepEqual(got, [[42, 'alert!']]);
});

test('createAdminNotifier: ошибка отправки не пробрасывается (best-effort)', async () => {
  const notify = createAdminNotifier({
    adminChatId: 42,
    send: () => Promise.reject(new Error('telegram down')),
    logger: silent,
  });
  await notify('alert!'); // не должно бросить
});

// ── createFailureAlerter ─────────────────────────────────────────────────────

function recorder(): { notify: (t: string) => Promise<void>; msgs: string[] } {
  const msgs: string[] = [];
  return { notify: async (t) => void msgs.push(t), msgs };
}

test('createFailureAlerter: алерт ровно на N-м подряд сбое, не раньше и не повторно', async () => {
  const { notify, msgs } = recorder();
  const record = createFailureAlerter({ threshold: 3, notify, label: 'global-pass' });

  await record(true);
  await record(true);
  assert.equal(msgs.length, 0); // 2 сбоя — ещё тихо
  await record(true);
  assert.equal(msgs.length, 1); // 3-й подряд — один алерт
  await record(true);
  assert.equal(msgs.length, 1); // дальше молчим (один алерт на инцидент)
});

test('createFailureAlerter: после алерта успех → «восстановлено» и сброс стрика', async () => {
  const { notify, msgs } = recorder();
  const record = createFailureAlerter({ threshold: 2, notify, label: 'global-pass' });

  await record(true);
  await record(true); // алерт #1
  await record(false); // восстановление #2
  assert.equal(msgs.length, 2);
  // стрик сброшен: снова нужно threshold сбоев для нового алерта
  await record(true);
  assert.equal(msgs.length, 2);
  await record(true);
  assert.equal(msgs.length, 3);
});

test('createFailureAlerter: успех без предшествующего алерта — тишина', async () => {
  const { notify, msgs } = recorder();
  const record = createFailureAlerter({ threshold: 3, notify, label: 'x' });

  await record(true);
  await record(false); // стрик < threshold, алерта не было → ничего
  assert.equal(msgs.length, 0);
});
