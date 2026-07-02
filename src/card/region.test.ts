import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagEmoji, primaryRegion } from './region.js';

test('flagEmoji: ISO-2 → флаг, иначе пусто', () => {
  assert.equal(flagEmoji('RU'), '🇷🇺');
  assert.equal(flagEmoji('US'), '🇺🇸');
  assert.equal(flagEmoji('GLOBAL'), '');
  assert.equal(flagEmoji('xx'), '');
});

test('primaryRegion: первая настоящая страна, GLOBAL пропускаем', () => {
  assert.equal(primaryRegion(['GLOBAL']), undefined);
  assert.equal(primaryRegion(['RU', 'UA']), 'RU');
  assert.equal(primaryRegion([]), undefined);
  assert.equal(primaryRegion(['GLOBAL', 'RU']), 'RU');
});
