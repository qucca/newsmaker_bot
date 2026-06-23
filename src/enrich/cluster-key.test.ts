import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveClusterKey } from './cluster-key.js';

test('deriveClusterKey: lowercase, сортировка, склейка через |', () => {
  assert.equal(deriveClusterKey(['NATO', 'Ukraine']), 'nato|ukraine');
});

test('deriveClusterKey: убирает диакритику и пунктуацию', () => {
  assert.equal(deriveClusterKey(['São Paulo', 'U.S.A.']), 'sao paulo|usa');
});

test('deriveClusterKey: дедуп после нормализации', () => {
  assert.equal(deriveClusterKey(['Apple', 'apple']), 'apple');
});

test('deriveClusterKey: топ-5 по порядку значимости, потом сортировка', () => {
  // 6 сущностей → берём первые 5 (e6 отбрасывается), затем сортируем
  assert.equal(deriveClusterKey(['e5', 'e4', 'e3', 'e2', 'e1', 'zz']), 'e1|e2|e3|e4|e5');
});

test('deriveClusterKey: пустой вход → пустой ключ', () => {
  assert.equal(deriveClusterKey([]), '');
});

test('deriveClusterKey: сущности, ставшие пустыми после нормализации, отброшены', () => {
  assert.equal(deriveClusterKey(['!!!', 'Tesla']), 'tesla');
});
