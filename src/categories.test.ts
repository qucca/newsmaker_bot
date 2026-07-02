import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  SELECTABLE_CATEGORIES,
  CATEGORY_GROUPS,
  categoryIndex,
  categoryByIndex,
} from './categories.js';

test('таксономия: слаги уникальны', () => {
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});

test('таксономия: CATEGORIES == объединение листьев групп + catch-all (без потерь и дублей)', () => {
  const fromGroups = CATEGORY_GROUPS.flatMap((g) => [...g.leaves, g.catchAll]);
  assert.equal(new Set(fromGroups).size, fromGroups.length, 'нет дублей между группами');
  assert.deepEqual([...fromGroups].sort(), [...CATEGORIES].sort());
});

test('таксономия: SELECTABLE_CATEGORIES == только листья (без catch-all)', () => {
  const leaves = CATEGORY_GROUPS.flatMap((g) => g.leaves);
  assert.deepEqual([...SELECTABLE_CATEGORIES].sort(), [...leaves].sort());
});

test('таксономия: каждый слаг принадлежит ровно одной группе', () => {
  for (const cat of CATEGORIES) {
    const owners = CATEGORY_GROUPS.filter(
      (g) => g.leaves.includes(cat) || g.catchAll === cat,
    );
    assert.equal(owners.length, 1, `слаг ${cat} в ${owners.length} группах`);
  }
});

test('таксономия: catch-all каждой группы — *_other и НЕ входит в выбираемые листья', () => {
  for (const g of CATEGORY_GROUPS) {
    assert.ok(g.catchAll.endsWith('_other'), `группа ${g.group}: catchAll не *_other`);
    assert.ok(!g.leaves.includes(g.catchAll), `группа ${g.group}: catchAll просочился в leaves`);
  }
});

test('P2a: ни один выбираемый лист не является catch-all (*_other скрыты из онбординга)', () => {
  for (const cat of SELECTABLE_CATEGORIES) {
    assert.ok(!cat.endsWith('_other'), `выбираемый лист ${cat} — это catch-all`);
  }
});

test('таксономия: согласованный размер словаря (10 групп / 53 enum / 43 выбираемых)', () => {
  assert.equal(CATEGORY_GROUPS.length, 10);
  assert.equal(CATEGORIES.length, 53);
  assert.equal(SELECTABLE_CATEGORIES.length, 43);
  for (const g of CATEGORY_GROUPS) assert.ok(g.leaves.length >= 2, `группа ${g.group} < 2 листьев`);
});

test('P1: domestic_politics переименован в elections_government', () => {
  assert.ok((CATEGORIES as readonly string[]).includes('elections_government'));
  assert.ok(!(CATEGORIES as readonly string[]).includes('domestic_politics'));
});

test('B: gaming и esports — оба отдельные листья', () => {
  assert.ok((SELECTABLE_CATEGORIES as readonly string[]).includes('gaming'));
  assert.ok((SELECTABLE_CATEGORIES as readonly string[]).includes('esports'));
});

test('P4: группа lifestyle с travel/food_drink/fashion_style/autos; старый лист lifestyle убран', () => {
  const lifestyle = CATEGORY_GROUPS.find((g) => g.group === 'lifestyle');
  assert.ok(lifestyle !== undefined, 'нет группы lifestyle');
  for (const leaf of ['travel', 'food_drink', 'fashion_style', 'autos'] as const) {
    assert.ok(lifestyle.leaves.includes(leaf), `lifestyle без ${leaf}`);
  }
  assert.equal(lifestyle.catchAll, 'lifestyle_other');
  assert.ok(!(SELECTABLE_CATEGORIES as readonly string[]).includes('lifestyle'), 'старый лист lifestyle всё ещё выбираем');
});

test('P4: новые тематические листья присутствуют', () => {
  for (const leaf of ['personal_finance', 'real_estate', 'weather_disasters'] as const) {
    assert.ok((SELECTABLE_CATEGORIES as readonly string[]).includes(leaf), `нет листа ${leaf}`);
  }
});

test('categoryIndex ↔ categoryByIndex round-trip', () => {
  assert.equal(categoryByIndex(categoryIndex('football')), 'football');
  assert.equal(categoryIndex(CATEGORIES[0]!), 0);
  assert.equal(categoryByIndex(-1), undefined);
  assert.equal(categoryByIndex(9999), undefined);
});
