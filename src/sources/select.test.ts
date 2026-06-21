import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, applyCap } from './select.js';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const MAX_AGE = 72 * HOUR;

test('isFresh: запись без даты оставляем', () => {
  assert.equal(isFresh(null, NOW, MAX_AGE), true);
});

test('isFresh: свежее окна — оставляем', () => {
  assert.equal(isFresh(NOW - 10 * HOUR, NOW, MAX_AGE), true);
});

test('isFresh: ровно на границе окна — оставляем', () => {
  assert.equal(isFresh(NOW - MAX_AGE, NOW, MAX_AGE), true);
});

test('isFresh: старше окна — выкидываем', () => {
  assert.equal(isFresh(NOW - MAX_AGE - 1, NOW, MAX_AGE), false);
});

test('isFresh: дата из будущего — оставляем', () => {
  assert.equal(isFresh(NOW + HOUR, NOW, MAX_AGE), true);
});

test('applyCap: возвращает всё, когда под капом', () => {
  const items = [{ publishedAt: 3 }, { publishedAt: 1 }, { publishedAt: 2 }];
  assert.equal(applyCap(items, 10).length, 3);
});

test('applyCap: оставляет самые свежие при превышении', () => {
  const items = [{ publishedAt: 1 }, { publishedAt: 5 }, { publishedAt: 3 }, { publishedAt: 4 }];
  const capped = applyCap(items, 2);
  assert.deepEqual(
    capped.map((i) => i.publishedAt),
    [5, 4],
  );
});

test('applyCap: записи без даты сортируются в конец (выпадают первыми под капом)', () => {
  const items = [
    { publishedAt: null },
    { publishedAt: 10 },
    { publishedAt: null },
    { publishedAt: 20 },
  ];
  const capped = applyCap(items, 2);
  assert.deepEqual(
    capped.map((i) => i.publishedAt),
    [20, 10],
  );
});
