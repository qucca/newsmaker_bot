import type { ZodType } from 'zod';

export type ModelRole = 'default' | 'render';

/** Блок входа; cache:true помечает стабильный префикс (system, канонические факты). */
export interface PromptBlock {
  text: string;
  cache?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface StructuredRequest<T> {
  role?: ModelRole; // 'default' по умолчанию
  system: PromptBlock[];
  input: PromptBlock[];
  /** Валидатор ответа: что принимаем и возвращаем как T. */
  schema: ZodType<T>;
  /**
   * Схема-подсказка для output_config.format (что ПРОСИМ у модели). По умолчанию = schema.
   * Разводится со schema, когда валидация должна быть мягче подсказки — напр. батч, где
   * клиент принимает «любой массив», а per-item отбор делает вызывающий (см. enrich).
   */
  formatSchema?: ZodType<unknown>;
  schemaName: string;
  maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  value: T;
  usage: Usage;
  model: string;
}

export interface LLMClient {
  readonly provider: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** Внутренний контракт адаптера. raw — распарсенный объект ДО zod-валидации. */
export interface ProviderRequest {
  role: ModelRole;
  system: PromptBlock[];
  input: PromptBlock[];
  schema: ZodType<unknown>;
  schemaName: string;
  maxOutputTokens: number;
}
export interface ProviderResult {
  raw: unknown;
  usage: Usage;
  model: string;
}
export interface ProviderAdapter {
  readonly provider: string;
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

/** Зарезервированный шов под Batch API. Реализуется ПОЗЖЕ (T11/T15). В T6 тел нет. */
export interface BatchCapable {
  submitBatch(reqs: ProviderRequest[]): Promise<{ batchId: string }>;
  pollBatch(id: string): Promise<'in_progress' | 'completed' | 'failed'>;
  retrieveBatch(id: string): Promise<ProviderResult[]>;
}

export class LlmSchemaError extends Error {
  constructor(
    readonly provider: string,
    readonly schemaName: string,
  ) {
    super(`LLM ответ не прошёл схему "${schemaName}" (provider=${provider}) после ретрая`);
    this.name = 'LlmSchemaError';
  }
}
