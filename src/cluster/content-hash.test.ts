import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashNeutralFacts } from './content-hash.js';

test('hashNeutralFacts: одинаковый вход → одинаковый хеш', () => {
  assert.equal(hashNeutralFacts(['Fact one.', 'Fact two.']), hashNeutralFacts(['Fact one.', 'Fact two.']));
});

test('hashNeutralFacts: порядок фактов значим', () => {
  assert.notEqual(hashNeutralFacts(['A', 'B']), hashNeutralFacts(['B', 'A']));
});

test('hashNeutralFacts: разный контент → разный хеш', () => {
  assert.notEqual(hashNeutralFacts(['A']), hashNeutralFacts(['B']));
});

test('hashNeutralFacts: пустой массив даёт стабильный хеш', () => {
  assert.equal(hashNeutralFacts([]), hashNeutralFacts([]));
});
