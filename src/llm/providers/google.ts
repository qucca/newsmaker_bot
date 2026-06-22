// Адаптер провайдера Google (Gemini): чистый билдер параметров + чистый парсер результата +
// фабрика с инъектируемым transport (по умолчанию — реальный SDK), обёрнутым в withRetry.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Logger } from '../../log/index.js';
import { withRetry, isRetryableStatus } from '../../sources/retry.js';
import type { ModelRole, ProviderAdapter, ProviderRequest, ProviderResult } from '../types.js';

// Минимальные структурные типы того, что нам нужно от SDK (без any).
interface GoogleResponse {
  text: string;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    cachedContentTokenCount?: number;
  };
}
type GoogleTransport = (params: ReturnType<typeof buildGoogleParams>) => Promise<GoogleResponse>;

export function buildGoogleParams(req: ProviderRequest, models: Record<ModelRole, string>) {
  // cache:true намеренно не транслируется: implicit/cached content в Gemini устроен
  // по-своему (provider-specific), в MVP no-op — system и input просто склеиваются в contents.
  const systemText = req.system.map((b) => b.text).join('\n');
  const userText = req.input.map((b) => b.text).join('\n');
  return {
    model: models[req.role],
    contents: `${systemText}\n\n${userText}`,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(req.schema),
      maxOutputTokens: req.maxOutputTokens,
      temperature: 0,
    },
  };
}

export function parseGoogleResult(raw: unknown, model: string): ProviderResult {
  const r = raw as GoogleResponse;
  if (r.text === undefined || r.text === null || r.text === '') {
    throw new Error('google: пустой ответ');
  }
  return {
    raw: JSON.parse(r.text),
    usage: {
      inputTokens: r.usageMetadata.promptTokenCount,
      outputTokens: r.usageMetadata.candidatesTokenCount,
      cachedInputTokens: r.usageMetadata.cachedContentTokenCount,
    },
    model,
  };
}

export function createGoogleAdapter(opts: {
  apiKey: string;
  models: Record<ModelRole, string>;
  logger: Logger;
  transport?: GoogleTransport;
}): ProviderAdapter {
  const transport: GoogleTransport =
    opts.transport ??
    ((params) => {
      const client = new GoogleGenAI({ apiKey: opts.apiKey });
      // Реальный тип ответа SDK шире нашего минимального структурного интерфейса;
      // сужаем намеренно — нам нужны только text и usageMetadata.
      return client.models.generateContent(params) as unknown as Promise<GoogleResponse>;
    });
  return {
    provider: 'google',
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const params = buildGoogleParams(req, opts.models);
      const res = await withRetry((): Promise<GoogleResponse> => transport(params), {
        maxRetries: 2,
        isRetryable: (e) => isRetryableStatus((e as { status?: number }).status ?? 0),
      });
      return parseGoogleResult(res, params.model);
    },
  };
}
