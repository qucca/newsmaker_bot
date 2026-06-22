// Адаптер провайдера Anthropic: чистый билдер параметров + чистый парсер результата +
// фабрика с инъектируемым transport (по умолчанию — реальный SDK), обёрнутым в withRetry.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Logger } from '../../log/index.js';
import { withRetry, isRetryableStatus } from '../../sources/retry.js';
import type { ModelRole, ProviderAdapter, ProviderRequest, ProviderResult } from '../types.js';

// Минимальные структурные типы того, что нам нужно от SDK (без any).
interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content: AnthropicTextBlock[];
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
}
type AnthropicTransport = (params: ReturnType<typeof buildAnthropicParams>) => Promise<AnthropicResponse>;

export function buildAnthropicParams(req: ProviderRequest, models: Record<ModelRole, string>) {
  const system = req.system.map((b) => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache === true ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
  const userText = req.input.map((b) => b.text).join('\n');
  return {
    model: models[req.role],
    max_tokens: req.maxOutputTokens,
    temperature: 0,
    system,
    messages: [{ role: 'user' as const, content: userText }],
    // zodOutputFormat в установленной версии SDK принимает только схему (без имени) —
    // имя схемы (req.schemaName) используется только в логах клиента, не в запросе к API.
    output_config: { format: zodOutputFormat(req.schema) },
  };
}

export function parseAnthropicResult(raw: unknown, model: string): ProviderResult {
  const r = raw as AnthropicResponse;
  const textBlock = r.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (textBlock?.text === undefined) throw new Error('anthropic: в ответе нет text-блока');
  return {
    raw: JSON.parse(textBlock.text),
    usage: {
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cachedInputTokens: r.usage.cache_read_input_tokens,
    },
    model,
  };
}

export function createAnthropicAdapter(opts: {
  apiKey: string;
  models: Record<ModelRole, string>;
  logger: Logger;
  transport?: AnthropicTransport;
}): ProviderAdapter {
  const transport: AnthropicTransport =
    opts.transport ??
    ((params) => {
      const client = new Anthropic({ apiKey: opts.apiKey });
      // Реальный тип ответа SDK шире нашего минимального структурного интерфейса;
      // сужаем намеренно — нам нужны только text-блоки и usage.
      return client.messages.create(params) as unknown as Promise<AnthropicResponse>;
    });
  return {
    provider: 'anthropic',
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const params = buildAnthropicParams(req, opts.models);
      const res = await withRetry((): Promise<AnthropicResponse> => transport(params), {
        maxRetries: 2,
        isRetryable: (e) => isRetryableStatus((e as { status?: number }).status ?? 0),
      });
      return parseAnthropicResult(res, params.model);
    },
  };
}
