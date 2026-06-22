import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLLMClient } from './factory.ts';
import type { LlmConfig } from '../config/index.ts';

const silent = { info() {}, warn() {}, error() {} };
const cfg = (provider: 'anthropic' | 'openai' | 'google'): LlmConfig => ({
  provider,
  apiKey: 'k',
  models: { default: 'm', render: 'm' },
});

test('создаёт клиента нужного провайдера', async () => {
  for (const p of ['anthropic', 'openai', 'google'] as const) {
    const client = await createLLMClient(cfg(p), { logger: silent });
    assert.equal(client.provider, p);
  }
});
