import type Database from 'better-sqlite3';
import { resolveLlmConfig } from '../config/index.js';
import {
  selectUnenriched,
  writeEnrichment,
  type EnrichmentWrite,
} from '../db/articles.js';
import { createLLMClient, type LLMClient } from '../llm/index.js';
import { createLogger, type Logger } from '../log/index.js';
import { deriveClusterKey } from './cluster-key.js';
import { buildEnrichPrompt, type EnrichInput } from './prompt.js';
import { makeBatchSchema, type EnrichItem } from './schema.js';

// Дефолты дублируют config (MAX_ENRICH_BATCH/ENRICH_RUN_CAP): оркестратор не зовёт getConfig
// (тестируемость), слой запуска (T15) передаст значения из конфига через deps.
const DEFAULT_MAX_BATCH = 20;
const DEFAULT_RUN_CAP = 200;
const ENRICH_MAX_OUTPUT_TOKENS = 4096; // батч до ~20 объектов JSON

export interface EnrichDeps {
  now?: () => number;
  logger?: Logger;
  maxBatch?: number;
  runCap?: number;
}

export interface EnrichResult {
  selected: number;
  enriched: number;
  skipped: number;
}

/**
 * Глобальный проход обогащения: новые кандидаты (enriched_at IS NULL) → батч-вызовы LLM →
 * запись полей в articles. Битый чанк изолируется (лог + пропуск, статьи остаются
 * необогащёнными и дообработаются в следующий прогон). Кластеры (T8) не трогаются.
 */
export async function enrichPending(
  db: Database.Database,
  llm: LLMClient,
  deps: EnrichDeps = {},
): Promise<EnrichResult> {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? createLogger('enrich');
  const maxBatch = deps.maxBatch ?? DEFAULT_MAX_BATCH;
  const runCap = deps.runCap ?? DEFAULT_RUN_CAP;

  const pending = selectUnenriched(db, runCap);
  let enriched = 0;
  let skipped = 0;

  for (let i = 0; i < pending.length; i += maxBatch) {
    const chunk = pending.slice(i, i + maxBatch);
    const batch: EnrichInput[] = chunk.map((a, idx) => ({
      ref: idx,
      source: a.source,
      lang: a.lang,
      title: a.title,
      description: a.description,
    }));
    const refs = batch.map((b) => b.ref);
    const { system, input } = buildEnrichPrompt(batch);

    try {
      const res = await llm.generateStructured<EnrichItem[]>({
        system,
        input,
        schema: makeBatchSchema(refs),
        schemaName: 'enrich_batch',
        maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
      });
      const ts = now();
      const writes: EnrichmentWrite[] = res.value.map((item) => {
        const article = chunk[item.ref]!; // ref валидирован схемой: ∈ [0, chunk.length)
        return {
          id: article.id,
          clusterKey: deriveClusterKey(item.entities),
          entities: item.entities,
          tags: item.tags,
          quality: item.quality,
          isUrgent: item.is_urgent,
          isMajor: item.is_major,
          neutralFacts: item.neutral_facts,
          enrichedAt: ts,
        };
      });
      writeEnrichment(db, writes);
      enriched += writes.length;
    } catch (err) {
      skipped += chunk.length;
      logger.warn('enrich chunk skipped', {
        size: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('enrich done', { selected: pending.length, enriched, skipped });
  return { selected: pending.length, enriched, skipped };
}

/**
 * Строит LLM-клиент для прогона обогащения. resolveLlmConfig здесь — реальный fail-fast
 * «нет провайдера/ключа» (follow-up из T6). По умолчанию читает process.env.
 */
export async function resolveEnrichClient(
  logger: Logger,
  env: Record<string, string | undefined> = process.env,
): Promise<LLMClient> {
  const llmConfig = resolveLlmConfig(env);
  return createLLMClient(llmConfig, { logger });
}
