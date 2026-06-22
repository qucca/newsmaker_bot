import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmConfig } from './index.ts';

test('anthropic: дефолтные модели по ролям, обязателен только его ключ', () => {
  const c = resolveLlmConfig({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
  assert.equal(c.provider, 'anthropic');
  assert.equal(c.apiKey, 'k');
  assert.equal(c.models.default, 'claude-haiku-4-5');
  assert.equal(c.models.render, 'claude-sonnet-4-6');
});

test('render не задан → fallback на default', () => {
  const c = resolveLlmConfig({
    LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', LLM_MODEL_DEFAULT: 'gpt-x',
  });
  assert.equal(c.models.default, 'gpt-x');
  assert.equal(c.models.render, 'gpt-x');
});

test('не-anthropic без LLM_MODEL_DEFAULT → ошибка', () => {
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'k' }), /LLM_MODEL_DEFAULT/);
});

test('нет ключа выбранного провайдера → ошибка без значения', () => {
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: 'anthropic' }), /ANTHROPIC_API_KEY/);
});

test('неизвестный провайдер → ошибка', () => {
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: 'grok' }), /LLM_PROVIDER/);
});
