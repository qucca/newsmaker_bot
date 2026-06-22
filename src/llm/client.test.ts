import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createClient } from './client.ts';
import { createFakeAdapter } from './providers/fake.ts';
import { LlmSchemaError } from './types.ts';
import type { ProviderResult } from './types.ts';

const silent = { info() {}, warn() {}, error() {} };
const Schema = z.object({ tag: z.string() });
const ok = (raw: unknown): ProviderResult => ({
  raw,
  usage: { inputTokens: 1, outputTokens: 1 },
  model: 'm',
});

const req = {
  schemaName: 'x',
  schema: Schema,
  system: [{ text: 's', cache: true }],
  input: [{ text: 'i' }],
};

test('валидный ответ → value провалидирован, usage/model проброшены', async () => {
  const adapter = createFakeAdapter({ results: [ok({ tag: 'a' })] });
  const client = createClient(adapter, { logger: silent });
  const res = await client.generateStructured(req);
  assert.deepEqual(res.value, { tag: 'a' });
  assert.equal(res.model, 'm');
});

test('битый ответ один раз → один ретрай → успех', async () => {
  const adapter = createFakeAdapter({ results: [ok({ wrong: 1 }), ok({ tag: 'b' })] });
  const client = createClient(adapter, { logger: silent });
  const res = await client.generateStructured(req);
  assert.deepEqual(res.value, { tag: 'b' });
  assert.equal(adapter.calls.length, 2); // ровно один ретрай
});

test('битый ответ дважды → LlmSchemaError, не больше двух попыток', async () => {
  const adapter = createFakeAdapter({ results: [ok({}), ok({})] });
  const client = createClient(adapter, { logger: silent });
  await assert.rejects(() => client.generateStructured(req), LlmSchemaError);
  assert.equal(adapter.calls.length, 2);
});

test('role по умолчанию default; cache-флаг доходит до адаптера без потерь', async () => {
  const adapter = createFakeAdapter({ results: [ok({ tag: 'a' })] });
  const client = createClient(adapter, { logger: silent });
  await client.generateStructured(req);
  assert.equal(adapter.calls[0].role, 'default');
  assert.equal(adapter.calls[0].system[0].cache, true);
  assert.equal(adapter.calls[0].maxOutputTokens, 1024); // дефолт
});
