import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTime, pickCluster, pickRepresentative } from './match.js';

const H = 3_600_000;
const WINDOW = 72 * H;

test('eventTime: publishedAt при наличии, иначе fetchedAt', () => {
  assert.equal(eventTime({ publishedAt: 100, fetchedAt: 200 }), 100);
  assert.equal(eventTime({ publishedAt: null, fetchedAt: 200 }), 200);
});

test('pickCluster: кандидат на границе окна выбирается', () => {
  assert.equal(pickCluster([{ id: 1, firstSeen: 0 }], WINDOW, WINDOW), 1);
});

test('pickCluster: кандидат за окном отбрасывается → null', () => {
  assert.equal(pickCluster([{ id: 1, firstSeen: 0 }], WINDOW + 1, WINDOW), null);
});

test('pickCluster: пустой список → null', () => {
  assert.equal(pickCluster([], 100, WINDOW), null);
});

test('pickCluster: из нескольких — наибольший first_seen', () => {
  assert.equal(
    pickCluster([{ id: 1, firstSeen: 0 }, { id: 2, firstSeen: 10 * H }], 20 * H, WINDOW),
    2,
  );
});

test('pickCluster: тай-брейк — наибольший id при равном first_seen', () => {
  assert.equal(
    pickCluster([{ id: 1, firstSeen: 5 * H }, { id: 3, firstSeen: 5 * H }], 6 * H, WINDOW),
    3,
  );
});

test('pickRepresentative: побеждает наибольший quality', () => {
  assert.equal(
    pickRepresentative([
      { id: 1, quality: 50, publishedAt: 100 },
      { id: 2, quality: 80, publishedAt: 200 },
    ]).id,
    2,
  );
});

test('pickRepresentative: тай-брейк — ранний publishedAt', () => {
  assert.equal(
    pickRepresentative([
      { id: 1, quality: 80, publishedAt: 300 },
      { id: 2, quality: 80, publishedAt: 100 },
    ]).id,
    2,
  );
});

test('pickRepresentative: publishedAt=null проигрывает не-null (nulls last)', () => {
  assert.equal(
    pickRepresentative([
      { id: 1, quality: 80, publishedAt: null },
      { id: 2, quality: 80, publishedAt: 500 },
    ]).id,
    2,
  );
});

test('pickRepresentative: финальный тай-брейк — меньший id', () => {
  assert.equal(
    pickRepresentative([
      { id: 5, quality: 80, publishedAt: 100 },
      { id: 2, quality: 80, publishedAt: 100 },
    ]).id,
    2,
  );
});
