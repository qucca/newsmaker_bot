import type Database from 'better-sqlite3';
import type { UserRow } from '../db/users.js';
import type { ScoredCluster } from '../score/rank.js';
import { getSummary } from '../db/summaries.js';
import { selectRepresentative } from '../db/articles.js';
import { createLogger, type Logger } from '../log/index.js';
import { composeCard, type CardMessage } from './compose.js';

// T12: сборка карточек per-user из шорт-листа ранжирования (T10). Читает кеш summaries
// (наполняет render T11 ДО вызова — забота слоя запуска T15). Без LLM, без отправки.

export interface UserCard {
  clusterId: number; // для sent_log в T13 (дедуп отправки по cluster_id)
  message: CardMessage;
}

export interface BuildCardsDeps {
  logger?: Logger;
}

/**
 * Собирает карточки для шорт-листа юзера. Изолирует пропуск кластера (нет саммари в
 * кеше / нет представителя): лог + skip, не валит остальные. Порядок = порядок scored.
 */
export function buildUserCards(
  db: Database.Database,
  user: UserRow,
  scored: ScoredCluster[],
  deps: BuildCardsDeps = {},
): UserCard[] {
  const logger = deps.logger ?? createLogger('card');
  const cards: UserCard[] = [];

  for (const s of scored) {
    const summary = getSummary(db, s.clusterId, user.lang);
    if (summary === undefined) {
      logger.warn('card skipped: no cached summary', { clusterId: s.clusterId, lang: user.lang });
      continue;
    }
    if (s.repArticleId === null) {
      logger.warn('card skipped: no representative', { clusterId: s.clusterId });
      continue;
    }
    const rep = selectRepresentative(db, s.repArticleId);
    if (rep === undefined) {
      logger.warn('card skipped: representative not found', {
        clusterId: s.clusterId,
        repArticleId: s.repArticleId,
      });
      continue;
    }
    const message = composeCard({
      title: summary.title,
      summary: summary.summary,
      url: rep.url,
      source: rep.source,
      whyTags: s.matchedTags,
      lang: user.lang,
    });
    cards.push({ clusterId: s.clusterId, message });
  }

  logger.info('cards built', { scored: scored.length, built: cards.length });
  return cards;
}
