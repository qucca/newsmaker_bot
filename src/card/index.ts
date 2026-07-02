import type Database from 'better-sqlite3';
import type { UserRow } from '../db/users.js';
import type { ScoredCluster } from '../score/rank.js';
import { getSummary } from '../db/summaries.js';
import { selectRepresentative } from '../db/articles.js';
import { getCardsSentTotal } from '../db/users.js';
import { getClusterRegions } from '../db/clusters.js';
import { createLogger, type Logger } from '../log/index.js';
import { composeCard, type CardMessage } from './compose.js';
import { primaryRegion } from './region.js';

// Окно калибровки: кнопки 👍/👎 показываем только на первых N карточках, что юзер вообще получил
// (lifetime-счётчик users.cards_sent_total — НЕ COUNT(sent_log): ретенция чистит sent_log, а
// счётчик монотонный). N — порог-решение (PLAN.md «Решения T14»); проброс из config — T15.
// Решение принимается ПРИ СБОРКЕ; старые сообщения не редактируем (нет трекинга message_id).
const CALIBRATION_CARDS = 30;

// T12: сборка карточек per-user из шорт-листа ранжирования (T10). Читает кеш summaries
// (наполняет render T11 ДО вызова — забота слоя запуска T15). Без LLM, без отправки.

export interface UserCard {
  clusterId: number; // для sent_log в T13 (дедуп отправки по cluster_id)
  message: CardMessage;
}

export interface BuildCardsDeps {
  logger?: Logger;
  calibrationCards?: number; // порог окна калибровки (дефолт CALIBRATION_CARDS); проброс из config — T15
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

  // Один раз на сборку: в окне калибровки ли юзер (кнопки фидбэка на все карточки дайджеста).
  const limit = deps.calibrationCards ?? CALIBRATION_CARDS;
  const withFeedback = getCardsSentTotal(db, user.chatId) < limit;

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
    const region = primaryRegion(getClusterRegions(db, s.clusterId));
    const message = composeCard({
      clusterId: s.clusterId,
      withFeedback,
      title: summary.title,
      summary: summary.summary,
      url: rep.url,
      source: rep.source,
      whyTags: s.matchedTags,
      lang: user.lang,
      region,
    });
    cards.push({ clusterId: s.clusterId, message });
  }

  logger.info('cards built', { scored: scored.length, built: cards.length });
  return cards;
}
