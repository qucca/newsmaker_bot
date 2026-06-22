import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildAnthropicParams, parseAnthropicResult, createAnthropicAdapter } from './anthropic.ts';
import type { ProviderRequest } from '../types.ts';

const silent = { info() {}, warn() {}, error() {} };
const Schema = z.object({ tag: z.string() });
const models = { default: 'claude-haiku-4-5', render: 'claude-sonnet-4-6' };
const baseReq: ProviderRequest = {
  role: 'default',
  schema: Schema,
  schemaName: 'enrichment',
  system: [{ text: 'SYS', cache: true }],
  input: [{ text: 'IN' }],
  maxOutputTokens: 400,
};

test('build: role→модель, cache:true → cache_control на system-блоке, format присутствует', () => {
  const p = buildAnthropicParams(baseReq, models);
  assert.equal(p.model, 'claude-haiku-4-5');
  assert.equal(p.max_tokens, 400);
  assert.equal(p.temperature, 0);
  assert.equal(p.system[0].cache_control?.type, 'ephemeral');
  assert.ok(p.output_config?.format, 'ожидается output_config.format из zod-схемы');
});

test('build: role=render → модель render, system без cache → без cache_control', () => {
  const p = buildAnthropicParams({ ...baseReq, role: 'render', system: [{ text: 'S' }] }, models);
  assert.equal(p.model, 'claude-sonnet-4-6');
  assert.equal(p.system[0].cache_control, undefined);
});

test('parse: извлекает JSON из text-блока, нормализует usage', () => {
  const raw = {
    content: [{ type: 'text', text: '{"tag":"a"}' }],
    usage: { input_tokens: 1200, output_tokens: 96, cache_read_input_tokens: 1100 },
  };
  const res = parseAnthropicResult(raw, 'claude-haiku-4-5');
  assert.deepEqual(res.raw, { tag: 'a' });
  assert.deepEqual(res.usage, { inputTokens: 1200, outputTokens: 96, cachedInputTokens: 1100 });
  assert.equal(res.model, 'claude-haiku-4-5');
});

test('complete: транспорт получает построенные params, возвращает нормализованный результат', async () => {
  let seen: unknown;
  const adapter = createAnthropicAdapter({
    apiKey: 'k',
    models,
    logger: silent,
    transport: (params) => {
      seen = params;
      return Promise.resolve({
        content: [{ type: 'text', text: '{"tag":"z"}' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    },
  });
  const res = await adapter.complete(baseReq);
  assert.deepEqual(res.raw, { tag: 'z' });
  assert.equal((seen as { model: string }).model, 'claude-haiku-4-5');
});
