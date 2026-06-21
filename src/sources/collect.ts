import type Database from 'better-sqlite3';
import { readEnabledL1Sources, updateConditionalGet } from '../db/sources.js';
import { createLogger, type Logger } from '../log/index.js';
import { fetchFeed, type FeedFetchResult } from './feed.js';
import { applyCap, isFresh } from './select.js';
import type { RawCandidate, SourceRow } from './types.js';

// Оркестрация сбора L1 (T4): читаем активные фиды, фетчим каждый изолированно,
// режем по свежести, ограничиваем пер-фид и общим капом. Результат — сырые кандидаты
// в памяти (в БД их пишет T5). Conditional-GET состояние сохраняем по ходу.

// Дефолты — поведенческие решения (согласованы): окно свежести = верхняя граница окна
// кластеризации; капы защищают от шумного фида и стоимости обогащения (T7).
const DEFAULT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_PER_FEED_CAP = 50;
const DEFAULT_GLOBAL_CAP = 500;

export interface CollectDeps {
  fetchFeed: (source: SourceRow) => Promise<FeedFetchResult>;
  now: () => number;
  logger: Logger;
  maxAgeMs: number;
  perFeedCap: number;
  globalCap: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Уступаем event loop между фидами, чтобы команды юзеров не подвисали (CLAUDE.md). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function collectL1Candidates(
  db: Database.Database,
  deps: Partial<CollectDeps> = {},
): Promise<RawCandidate[]> {
  const fetchOne =
    deps.fetchFeed ?? ((source: SourceRow): Promise<FeedFetchResult> => fetchFeed(source));
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? createLogger('sources');
  const maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const perFeedCap = deps.perFeedCap ?? DEFAULT_PER_FEED_CAP;
  const globalCap = deps.globalCap ?? DEFAULT_GLOBAL_CAP;

  const sources = readEnabledL1Sources(db);
  const collected: RawCandidate[] = [];

  for (const source of sources) {
    try {
      const result = await fetchOne(source);
      updateConditionalGet(db, source.id, {
        etag: result.etag,
        lastModified: result.lastModified,
        fetchedAt: now(),
      });

      if (result.status === 'not-modified') {
        logger.info('feed not modified', { sourceId: source.id, url: source.url });
      } else {
        const fresh = result.candidates.filter((c) => isFresh(c.publishedAt, now(), maxAgeMs));
        const capped = applyCap(fresh, perFeedCap);
        collected.push(...capped);
        logger.info('feed fetched', {
          sourceId: source.id,
          url: source.url,
          items: result.candidates.length,
          kept: capped.length,
        });
      }
    } catch (error) {
      // Изоляция: один упавший фид не валит прогон.
      logger.warn('feed failed', {
        sourceId: source.id,
        url: source.url,
        error: errorMessage(error),
      });
    }
    await yieldToEventLoop();
  }

  return applyCap(collected, globalCap);
}
