import type Database from 'better-sqlite3';
import { insertArticles, type ArticleInsert } from '../db/articles.js';
import { createLogger, type Logger } from '../log/index.js';
import { canonicalizeUrl } from './canonical.js';
import type { RawCandidate } from './types.js';

// Канонизация + дедуп прогона (T5): мост между сбором (RawCandidate в памяти) и БД.
// Порядок пайплайна (design.md): сбор → канонизация → ДЕДУП → обогащение. Здесь —
// канонизация и дедуп; обогащение (T7) идёт уже по записанным articles.

export interface PersistDeps {
  now: () => number;
  logger: Logger;
}

export interface PersistResult {
  collected: number; // сколько кандидатов пришло
  dropped: number; // отброшено (непарсимый/не-http URL)
  inserted: number; // реально вставлено новых (после дедупа по canonical_url)
}

/**
 * Канонизирует ссылки кандидатов, отбрасывает непарсимые (изоляция: не валит прогон)
 * и пишет остальное в articles с дедупом по canonical_url.
 */
export function persistCandidates(
  db: Database.Database,
  candidates: RawCandidate[],
  deps: Partial<PersistDeps> = {},
): PersistResult {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? createLogger('sources');

  const rows: ArticleInsert[] = [];
  let dropped = 0;

  for (const c of candidates) {
    const canonicalUrl = canonicalizeUrl(c.link);
    if (canonicalUrl === null) {
      dropped += 1;
      logger.warn('candidate dropped: unparseable url', { feedSourceId: c.feedSourceId });
      continue;
    }
    rows.push({
      canonicalUrl,
      source: c.source,
      feedSourceId: c.feedSourceId,
      lang: c.lang,
      title: c.title,
      publishedAt: c.publishedAt,
      fetchedAt: now(),
    });
  }

  const { inserted } = insertArticles(db, rows);
  return { collected: candidates.length, dropped, inserted };
}
