import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildGoogleParams, parseGoogleResult, createGoogleAdapter } from './google.ts';
import type { ProviderRequest } from '../types.ts';

const silent = { info() {}, warn() {}, error() {} };
const Schema = z.object({ tag: z.string() });
const models = { default: 'gemini-x', render: 'gemini-x-pro' };
const req: ProviderRequest = {
  role: 'default',
  schema: Schema,
  schemaName: 'enrichment',
  system: [{ text: 'SYS' }],
  input: [{ text: 'IN' }],
  maxOutputTokens: 400,
};

test('build: role→модель, JSON-режим со схемой', () => {
  const p = buildGoogleParams(req, models);
  assert.equal(p.model, 'gemini-x');
  assert.equal(p.config.temperature, 0);
  assert.equal(p.config.responseMimeType, 'application/json');
  assert.ok(p.config.responseJsonSchema, 'ожидается JSON Schema из zod');
});

test('parse: JSON из text, usageMetadata нормализован', () => {
  const raw = {
    text: '{"tag":"a"}',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 80 },
  };
  const res = parseGoogleResult(raw, 'gemini-x');
  assert.deepEqual(res.raw, { tag: 'a' });
  assert.deepEqual(res.usage, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 });
});

test('parse: пустой text (safety block / MAX_TOKENS) — явная ошибка без сырого ответа', () => {
  const raw = { text: undefined, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 } };
  assert.throws(() => parseGoogleResult(raw, 'gemini-x'), /пустой ответ/);
});

test('complete: транспорт получает params, отдаёт нормализованный результат', async () => {
  const adapter = createGoogleAdapter({
    apiKey: 'k',
    models,
    logger: silent,
    transport: () =>
      Promise.resolve({
        text: '{"tag":"z"}',
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
  });
  const res = await adapter.complete(req);
  assert.deepEqual(res.raw, { tag: 'z' });
});
