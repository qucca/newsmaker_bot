import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderSummarySchema } from './schema.js';

test('RenderSummarySchema: принимает валидный объект', () => {
  assert.equal(
    RenderSummarySchema.safeParse({ title: 'Заголовок', summary: 'Кратко о событии.' }).success,
    true,
  );
});

test('RenderSummarySchema: пустой title не проходит', () => {
  assert.equal(RenderSummarySchema.safeParse({ title: '', summary: 'x' }).success, false);
});

test('RenderSummarySchema: summary сверх потолка не проходит', () => {
  assert.equal(RenderSummarySchema.safeParse({ title: 'T', summary: 'x'.repeat(1001) }).success, false);
});
