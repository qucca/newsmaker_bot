import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichItemSchema, matchEnrichItems } from './schema.js';

function item(over: Record<string, unknown> = {}) {
  return {
    ref: 0,
    entities: ['NATO'],
    tags: ['football'],
    quality: 80,
    is_urgent: false,
    is_major: true,
    neutral_facts: ['Fact one.', 'Fact two.'],
    ...over,
  };
}

test('EnrichItemSchema: валидный объект проходит', () => {
  assert.equal(EnrichItemSchema.safeParse(item()).success, true);
});

test('EnrichItemSchema: тег вне словаря отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ tags: ['nonsense'] })).success, false);
});

test('EnrichItemSchema: quality вне 0..100 отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ quality: 200 })).success, false);
});

test('EnrichItemSchema: <2 нейтральных фактов отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ neutral_facts: ['only one'] })).success, false);
});

const refsOf = (items: { ref: number }[]) => items.map((i) => i.ref);

test('matchEnrichItems: берёт валидные объекты с ожидаемыми refs', () => {
  const got = matchEnrichItems([item({ ref: 0 }), item({ ref: 1 })], [0, 1]);
  assert.deepEqual(refsOf(got), [0, 1]);
});

test('matchEnrichItems: лишний объект (ref вне ожидаемых) отбрасывается', () => {
  const got = matchEnrichItems([item({ ref: 0 }), item({ ref: 1 }), item({ ref: 9 })], [0, 1]);
  assert.deepEqual(refsOf(got), [0, 1]);
});

test('matchEnrichItems: дубль ref дедуплицируется (первый выигрывает)', () => {
  const got = matchEnrichItems(
    [item({ ref: 0, quality: 10 }), item({ ref: 0, quality: 90 }), item({ ref: 1 })],
    [0, 1],
  );
  assert.deepEqual(refsOf(got), [0, 1]);
  assert.equal(got[0].quality, 10); // взят первый
});

test('matchEnrichItems: битый объект (тег вне словаря) отбрасывается, валидные остаются', () => {
  const got = matchEnrichItems([item({ ref: 0 }), item({ ref: 1, tags: ['nonsense'] })], [0, 1]);
  assert.deepEqual(refsOf(got), [0]);
});

test('matchEnrichItems: неполный ответ (меньше объектов) толерантен — без throw', () => {
  const got = matchEnrichItems([item({ ref: 0 })], [0, 1, 2]);
  assert.deepEqual(refsOf(got), [0]);
});

test('matchEnrichItems: не массив → пустой результат', () => {
  assert.deepEqual(matchEnrichItems(null, [0]), []);
  assert.deepEqual(matchEnrichItems({ ref: 0 }, [0]), []);
});
