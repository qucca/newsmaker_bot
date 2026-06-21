import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, isRetryableStatus, backoffCeilingMs } from './retry.js';

const noSleep = (): Promise<void> => Promise.resolve();

test('withRetry: возвращает результат с первой попытки без ретраев', async () => {
  let attempts = 0;
  const result = await withRetry(
    () => {
      attempts++;
      return Promise.resolve('ok');
    },
    { maxRetries: 2, sleep: noSleep },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 1);
});

test('withRetry: ретраит до успеха', async () => {
  let attempts = 0;
  const result = await withRetry(
    () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    },
    { maxRetries: 2, sleep: noSleep },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withRetry: исчерпав ретраи, бросает последнюю ошибку', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      () => {
        attempts++;
        return Promise.reject(new Error(`fail ${attempts}`));
      },
      { maxRetries: 2, sleep: noSleep },
    ),
    /fail 3/,
  );
  assert.equal(attempts, 3); // первая попытка + 2 ретрая
});

test('withRetry: не ретраит неретраебельную ошибку', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      () => {
        attempts++;
        return Promise.reject(new Error('4xx'));
      },
      { maxRetries: 3, sleep: noSleep, isRetryable: () => false },
    ),
    /4xx/,
  );
  assert.equal(attempts, 1);
});

test('isRetryableStatus: 5xx, 429, 408 — ретраебельны', () => {
  for (const s of [500, 502, 503, 504, 429, 408]) {
    assert.equal(isRetryableStatus(s), true, `status ${s}`);
  }
});

test('isRetryableStatus: 4xx (кроме 408/429) и 2xx — нет', () => {
  for (const s of [200, 304, 400, 401, 403, 404, 410]) {
    assert.equal(isRetryableStatus(s), false, `status ${s}`);
  }
});

test('backoffCeilingMs: экспоненциальный потолок от номера попытки', () => {
  assert.equal(backoffCeilingMs(0, 500), 500);
  assert.equal(backoffCeilingMs(1, 500), 1000);
  assert.equal(backoffCeilingMs(2, 500), 2000);
});
