// Фабрика LLM-клиента: по конфигу выбирает провайдера и лениво импортирует только его
// адаптер (рантайм не тащит SDK неиспользуемых провайдеров).
import type { Logger } from '../log/index.js';
import type { LlmConfig } from '../config/index.js';
import { createClient } from './client.js';
import type { LLMClient, ProviderAdapter } from './types.js';

export async function createLLMClient(
  llmConfig: LlmConfig,
  opts: { logger: Logger },
): Promise<LLMClient> {
  const base = { apiKey: llmConfig.apiKey, models: llmConfig.models, logger: opts.logger };
  let adapter: ProviderAdapter;
  switch (llmConfig.provider) {
    case 'anthropic': {
      const m = await import('./providers/anthropic.js');
      adapter = m.createAnthropicAdapter(base);
      break;
    }
    case 'openai': {
      const m = await import('./providers/openai.js');
      adapter = m.createOpenaiAdapter(base);
      break;
    }
    case 'google': {
      const m = await import('./providers/google.js');
      adapter = m.createGoogleAdapter(base);
      break;
    }
  }
  return createClient(adapter, { logger: opts.logger });
}
