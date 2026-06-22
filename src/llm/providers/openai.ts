// Адаптер провайдера OpenAI: чистый билдер параметров + чистый парсер результата +
// фабрика с инъектируемым transport (по умолчанию — реальный SDK), обёрнутым в withRetry.
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { Logger } from '../../log/index.js';
import { withRetry, isRetryableStatus } from '../../sources/retry.js';
import type { ModelRole, ProviderAdapter, ProviderRequest, ProviderResult } from '../types.js';

// Минимальные структурные типы того, что нам нужно от SDK (без any).
interface OpenaiResponse {
  choices: { message: { content: string | null } }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
type OpenaiTransport = (params: ReturnType<typeof buildOpenaiParams>) => Promise<OpenaiResponse>;

export function buildOpenaiParams(req: ProviderRequest, models: Record<ModelRole, string>) {
  // cache-флаг намеренно не транслируется: OpenAI кеширует стабильный префикс автоматически.
  return {
    model: models[req.role],
    // max_completion_tokens заменяет устаревший max_tokens в установленной версии SDK — не откатывать.
    max_completion_tokens: req.maxOutputTokens,
    temperature: 0,
    messages: [
      { role: 'system' as const, content: req.system.map((b) => b.text).join('\n') },
      { role: 'user' as const, content: req.input.map((b) => b.text).join('\n') },
    ],
    response_format: zodResponseFormat(req.schema, req.schemaName),
  };
}

export function parseOpenaiResult(raw: unknown, model: string): ProviderResult {
  const r = raw as OpenaiResponse;
  const content = r.choices[0]?.message.content;
  if (content === null || content === undefined) throw new Error('openai: пустой content');
  return {
    raw: JSON.parse(content),
    usage: {
      inputTokens: r.usage.prompt_tokens,
      outputTokens: r.usage.completion_tokens,
      cachedInputTokens: r.usage.prompt_tokens_details?.cached_tokens,
    },
    model,
  };
}

export function createOpenaiAdapter(opts: {
  apiKey: string;
  models: Record<ModelRole, string>;
  logger: Logger;
  transport?: OpenaiTransport;
}): ProviderAdapter {
  const transport: OpenaiTransport =
    opts.transport ??
    ((params) => {
      const client = new OpenAI({ apiKey: opts.apiKey });
      // Реальный тип ответа SDK шире нашего минимального структурного интерфейса;
      // сужаем намеренно — нам нужны только choices[].message.content и usage.
      return client.chat.completions.create(params) as unknown as Promise<OpenaiResponse>;
    });
  return {
    provider: 'openai',
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const params = buildOpenaiParams(req, opts.models);
      const res = await withRetry((): Promise<OpenaiResponse> => transport(params), {
        maxRetries: 2,
        isRetryable: (e) => isRetryableStatus((e as { status?: number }).status ?? 0),
      });
      return parseOpenaiResult(res, params.model);
    },
  };
}
