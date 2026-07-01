import type { Logger } from '../log/index.js';
import {
  LlmSchemaError,
  type LLMClient,
  type ProviderRequest,
  type StructuredRequest,
  type StructuredResult,
} from './types.js';
import type { ProviderAdapter } from './types.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const MAX_SCHEMA_ATTEMPTS = 2; // первая + один ретрай (CLAUDE.md)

export function createClient(adapter: ProviderAdapter, opts: { logger: Logger }): LLMClient {
  return {
    provider: adapter.provider,
    async generateStructured<T>(reqIn: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const provReq: ProviderRequest = {
        role: reqIn.role ?? 'default',
        system: reqIn.system,
        input: reqIn.input,
        // адаптер строит output_config.format из этой схемы — берём подсказку, если задана
        schema: reqIn.formatSchema ?? reqIn.schema,
        schemaName: reqIn.schemaName,
        maxOutputTokens: reqIn.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      };
      for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt++) {
        const res = await adapter.complete(provReq);
        const parsed = reqIn.schema.safeParse(res.raw);
        if (parsed.success) {
          opts.logger.info('llm ok', {
            provider: adapter.provider,
            model: res.model,
            role: provReq.role,
            schema: reqIn.schemaName,
            attempt,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            cachedInputTokens: res.usage.cachedInputTokens,
          });
          return { value: parsed.data, usage: res.usage, model: res.model };
        }
        opts.logger.warn('llm schema mismatch', {
          provider: adapter.provider,
          schema: reqIn.schemaName,
          attempt,
        }); // без сырого тела ответа
      }
      throw new LlmSchemaError(adapter.provider, reqIn.schemaName);
    },
  };
}
