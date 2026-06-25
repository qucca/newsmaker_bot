import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichItemSchema, makeBatchSchema } from './schema.js';

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

test('makeBatchSchema: проходит при совпадении refs', () => {
  const schema = makeBatchSchema([0, 1]);
  const res = schema.safeParse([item({ ref: 0 }), item({ ref: 1 })]);
  assert.equal(res.success, true);
});

test('makeBatchSchema: рассинхрон количества отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 })]).success, false);
});

test('makeBatchSchema: неизвестный ref отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 }), item({ ref: 9 })]).success, false);
});

test('makeBatchSchema: дублирующийся ref отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 }), item({ ref: 0 })]).success, false);
});
