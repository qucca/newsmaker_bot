import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from './session.js';

test('get/set/clear', () => {
  const s = createSessionStore<{ n: number }>();
  assert.equal(s.get(1), undefined);
  s.set(1, { n: 5 });
  assert.deepEqual(s.get(1), { n: 5 });
  s.clear(1);
  assert.equal(s.get(1), undefined);
});
