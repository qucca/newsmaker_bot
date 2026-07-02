import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReasonOptions } from './feedback-reason.js';

test('buildReasonOptions: одна страна → пара+тег+регион+источник (4)', () => {
  const o = buildReasonOptions('football', ['RU', 'GLOBAL']);
  assert.deepEqual(o, [
    { type: 'pair', tag: 'football', cc: 'RU' },
    { type: 'tag', tag: 'football' },
    { type: 'region', cc: 'RU' },
    { type: 'source' },
  ]);
});

test('buildReasonOptions: две страны → пара×2+тег+источник, регион жертвуем (4)', () => {
  const o = buildReasonOptions('football', ['RU', 'UA', 'BY']); // кап 2
  assert.deepEqual(o, [
    { type: 'pair', tag: 'football', cc: 'RU' },
    { type: 'pair', tag: 'football', cc: 'UA' },
    { type: 'tag', tag: 'football' },
    { type: 'source' },
  ]);
});

test('buildReasonOptions: GLOBAL → только тег+источник', () => {
  assert.deepEqual(buildReasonOptions('football', ['GLOBAL']), [
    { type: 'tag', tag: 'football' },
    { type: 'source' },
  ]);
});

test('buildReasonOptions: нет matched-тега → только регион(ы)+источник', () => {
  assert.deepEqual(buildReasonOptions(undefined, ['RU']), [
    { type: 'region', cc: 'RU' },
    { type: 'source' },
  ]);
});
