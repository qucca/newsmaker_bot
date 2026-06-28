import type Database from 'better-sqlite3';
import { resolveLlmConfig } from '../config/index.js';
import { selectClusterForRender, getSummary, upsertSummary } from '../db/summaries.js';
import { createLLMClient, type LLMClient } from '../llm/index.js';
import { createLogger, type Logger } from '../log/index.js';
import { buildRenderPrompt } from './prompt.js';
import { RenderSummarySchema, type RenderSummary } from './schema.js';

const RENDER_MAX_OUTPUT_TOKENS = 800; // дефолт; слой запуска (T15) пробрасывает RENDER_MAX_OUTPUT_TOKENS из config

/** Результат рендера одной пары: источник значения либо пропуск. */
export type RenderOutcome =
  | { status: 'cached' | 'rendered'; summary: RenderSummary }
  | { status: 'skipped' };

/** Пара к рендеру; список даёт сборка дайджеста (T12+), demand-driven. */
export interface RenderPair {
  clusterId: number;
  lang: string;
}

export interface RenderDeps {
  now?: () => number;
  logger?: Logger;
  maxOutputTokens?: number; // потолок токенов на саммари (дефолт RENDER_MAX_OUTPUT_TOKENS); проброс из config — T15
}

export interface RenderPairsResult {
  rendered: number;
  cached: number;
  skipped: number;
}

/**
 * Дай-или-отрендери саммари пары (cluster, lang). Кеш валиден при совпадении
 * content_hash кластера и строки кеша; рассинхрон (сменились факты/представитель) или
 * отсутствие строки → вызов LLM (роль render) + upsert. NULL-факты → пропуск.
 */
export async function getOrRenderSummary(
  db: Database.Database,
  llm: LLMClient,
  clusterId: number,
  lang: string,
  deps: RenderDeps = {},
): Promise<RenderOutcome> {
  const now = deps.now ?? Date.now;

  const cluster = selectClusterForRender(db, clusterId);
  if (!cluster || cluster.neutralFacts === null || cluster.contentHash === null) {
    return { status: 'skipped' };
  }

  const cached = getSummary(db, clusterId, lang);
  if (cached && cached.contentHash === cluster.contentHash) {
    return { status: 'cached', summary: { title: cached.title, summary: cached.summary } };
  }

  const facts = JSON.parse(cluster.neutralFacts) as string[];
  const entities = JSON.parse(cluster.entities) as string[];
  const { system, input } = buildRenderPrompt({ lang, entities, facts });

  const res = await llm.generateStructured<RenderSummary>({
    role: 'render',
    system,
    input,
    schema: RenderSummarySchema,
    schemaName: 'render_summary',
    maxOutputTokens: deps.maxOutputTokens ?? RENDER_MAX_OUTPUT_TOKENS,
  });

  upsertSummary(db, {
    clusterId,
    lang,
    title: res.value.title,
    summary: res.value.summary,
    contentHash: cluster.contentHash,
    model: res.model,
    createdAt: now(),
  });

  return { status: 'rendered', summary: res.value };
}

/**
 * Рендерит список пар (demand-driven вход). Изолирует сбой пары (лог + skip), уступает
 * event loop между парами (синхронный better-sqlite3 не должен подвешивать команды юзеров).
 */
export async function renderPairs(
  db: Database.Database,
  llm: LLMClient,
  pairs: RenderPair[],
  deps: RenderDeps = {},
): Promise<RenderPairsResult> {
  const logger = deps.logger ?? createLogger('render');
  let rendered = 0;
  let cached = 0;
  let skipped = 0;

  for (const pair of pairs) {
    try {
      const out = await getOrRenderSummary(db, llm, pair.clusterId, pair.lang, deps);
      if (out.status === 'rendered') rendered++;
      else if (out.status === 'cached') cached++;
      else skipped++;
    } catch (err) {
      skipped++;
      logger.warn('render pair skipped', {
        clusterId: pair.clusterId,
        lang: pair.lang,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve)); // уступить event loop
  }

  logger.info('render done', { pairs: pairs.length, rendered, cached, skipped });
  return { rendered, cached, skipped };
}

/**
 * Строит LLM-клиент для рендера. resolveLlmConfig — fail-fast «нет провайдера/ключа».
 * По умолчанию читает process.env. (Зеркало resolveEnrichClient из src/enrich.)
 */
export async function resolveRenderClient(
  logger: Logger,
  env: Record<string, string | undefined> = process.env,
): Promise<LLMClient> {
  const llmConfig = resolveLlmConfig(env);
  return createLLMClient(llmConfig, { logger });
}
