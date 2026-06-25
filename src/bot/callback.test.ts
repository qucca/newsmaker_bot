import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCb, decodeCb } from './callback.js';

test('round-trip', () => {
  assert.deepEqual(decodeCb(encodeCb(['ob', 'tag', 'football'])), ['ob', 'tag', 'football']);
});

test('encodeCb бросает при превышении 64 байт', () => {
  assert.throws(() => encodeCb(['ob', 'x'.repeat(70)]));
});

test('decodeCb разбивает по тильде', () => {
  assert.deepEqual(decodeCb('set~tz'), ['set', 'tz']);
});
