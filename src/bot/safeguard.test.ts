import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRegister, createStartLimiter } from './safeguard.js';

test('canRegister: строго меньше капа', () => {
  assert.equal(canRegister(99, 100), true);
  assert.equal(canRegister(100, 100), false);
  assert.equal(canRegister(101, 100), false);
});

test('startLimiter: второй /start в окне cooldown отклоняется, после — разрешается', () => {
  let now = 1000; // NOSONAR
  const lim = createStartLimiter(3000, () => now);
  assert.equal(lim.allow(7), true);   // первый
  assert.equal(lim.allow(7), false);  // сразу повтор
  now = 4500;                         // > 3000 спустя
  assert.equal(lim.allow(7), true);
});

test('startLimiter: разные чаты независимы', () => {
  const now = 1000;
  const lim = createStartLimiter(3000, () => now);
  assert.equal(lim.allow(1), true);
  assert.equal(lim.allow(2), true);
});
