import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildOpenaiParams, parseOpenaiResult, createOpenaiAdapter } from './openai.ts';
import type { ProviderRequest } from '../types.ts';

const silent = { info() {}, warn() {}, error() {} };
const Schema = z.object({ tag: z.string() });
const models = { default: 'gpt-x', render: 'gpt-x-pro' };
const req: ProviderRequest = {
  role: 'render',
  schema: Schema,
  schemaName: 'enrichment',
  system: [{ text: 'SYS', cache: true }],
  input: [{ text: 'IN' }],
  maxOutputTokens: 400,
};

test('build: role→модель, system+input в сообщениях, response_format присутствует', () => {
  const p = buildOpenaiParams(req, models);
  assert.equal(p.model, 'gpt-x-pro');
  assert.equal(p.temperature, 0);
  assert.equal(p.messages[0].role, 'system');
  assert.equal(p.messages[1].role, 'user');
  assert.ok(p.response_format, 'ожидается response_format из zod-схемы');
});

test('parse: JSON из message.content, usage нормализован (включая cached)', () => {
  const raw = {
    choices: [{ message: { content: '{"tag":"a"}' } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 80 },
    },
  };
  const res = parseOpenaiResult(raw, 'gpt-x');
  assert.deepEqual(res.raw, { tag: 'a' });
  assert.deepEqual(res.usage, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 });
});

test('complete: транспорт получает params, отдаёт нормализованный результат', async () => {
  const adapter = createOpenaiAdapter({
    apiKey: 'k',
    models,
    logger: silent,
    transport: () =>
      Promise.resolve({
        choices: [{ message: { content: '{"tag":"z"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
  });
  const res = await adapter.complete(req);
  assert.deepEqual(res.raw, { tag: 'z' });
});
