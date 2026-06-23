import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CATEGORIES } from './categories.js';

test('CATEGORIES: 12 уникальных провизорных категорий', () => {
  assert.equal(CATEGORIES.length, 12);
  assert.equal(new Set(CATEGORIES).size, 12);
  assert.ok(CATEGORIES.includes('world'));
  assert.ok(CATEGORIES.includes('technology'));
});

test('CATEGORIES: годится как источник для z.enum', () => {
  const e = z.enum(CATEGORIES);
  assert.equal(e.safeParse('sports').success, true);
  assert.equal(e.safeParse('nonsense').success, false);
});
