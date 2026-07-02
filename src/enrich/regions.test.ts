import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegions } from './regions.js';

test('normalizeRegions: ISO-2 upcased, deduped, capped, GLOBAL-фолбэк', () => {
  assert.deepEqual(normalizeRegions(['ru', 'US', 'ru', 'GLOBAL']), ['RU', 'US']);
  assert.deepEqual(normalizeRegions([]), ['GLOBAL']);
  assert.deepEqual(normalizeRegions(undefined), ['GLOBAL']);
  assert.deepEqual(normalizeRegions(['Russia', 'россия']), ['GLOBAL']); // не ISO-2 → отброшено
  assert.deepEqual(normalizeRegions(['RU', 'US', 'GB', 'FR', 'DE']), ['RU', 'US', 'GB', 'FR']); // кап 4
});
