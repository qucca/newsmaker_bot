import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_GROUPS } from './categories.js';

test('таксономия: слаги уникальны', () => {
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});

test('таксономия: объединение листьев групп == CATEGORIES (без потерь и дублей)', () => {
  const fromGroups = CATEGORY_GROUPS.flatMap((g) => g.leaves);
  assert.equal(new Set(fromGroups).size, fromGroups.length, 'нет дублей между группами');
  assert.deepEqual([...fromGroups].sort(), [...CATEGORIES].sort());
});

test('таксономия: каждый лист принадлежит ровно одной группе', () => {
  for (const cat of CATEGORIES) {
    const owners = CATEGORY_GROUPS.filter((g) => g.leaves.includes(cat));
    assert.equal(owners.length, 1, `лист ${cat} в ${owners.length} группах`);
  }
});

test('таксономия: в каждой группе есть catch-all *_other', () => {
  for (const g of CATEGORY_GROUPS) {
    assert.ok(
      g.leaves.some((l) => l.endsWith('_other')),
      `группа ${g.group} без *_other`,
    );
  }
});

test('таксономия: непустые группы и нетривиальный размер словаря', () => {
  assert.ok(CATEGORY_GROUPS.length >= 8);
  assert.ok(CATEGORIES.length >= 40);
  for (const g of CATEGORY_GROUPS) assert.ok(g.leaves.length >= 2);
});
