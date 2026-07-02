import type Database from 'better-sqlite3';

// Репозиторий ранжирования (T10): «глупый» SQL без доменной логики. Доменные правила
// (скор, тай-брейки) — в src/score. source_count считаем на лету COUNT(DISTINCT source).

/** Кандидат-кластер для ранжирования. tags/regions — JSON-строки (парсит ядро ранжирования). */
export interface CandidateRow {
  id: number;
  tags: string;
  regions: string;
  quality: number | null;
  isMajor: number;
  updatedAt: number;
  repArticleId: number | null;
  repSource: string | null;
  sourceCount: number;
}

const SELECT_CANDIDATES = `
  SELECT c.id, c.tags, c.regions, c.quality, c.is_major AS isMajor,
         c.updated_at AS updatedAt, c.rep_article_id AS repArticleId,
         r.source AS repSource,
         (SELECT COUNT(DISTINCT a.source) FROM articles a WHERE a.cluster_id = c.id) AS sourceCount
  FROM clusters c
  LEFT JOIN articles r ON r.id = c.rep_article_id
  WHERE c.updated_at >= @minUpdated
    AND c.id NOT IN (SELECT cluster_id FROM sent_log WHERE chat_id = @chatId)`;

/** Кластеры в окне свежести (updated_at >= minUpdated), НЕ отправленные юзеру. */
export function selectCandidateClusters(
  db: Database.Database,
  chatId: number,
  minUpdated: number,
): CandidateRow[] {
  return db.prepare(SELECT_CANDIDATES).all({ chatId, minUpdated }) as CandidateRow[];
}

/** Множество заблокированных юзером источников. */
export function selectBlockedSources(db: Database.Database, chatId: number): Set<string> {
  const rows = db
    .prepare(`SELECT source FROM blocked_sources WHERE chat_id = ?`)
    .all(chatId) as { source: string }[];
  return new Set(rows.map((r) => r.source));
}

export interface ReasonPenalties {
  source: Map<string, number>;
  tag: Map<string, number>;
  region: Map<string, number>;
  pair: Map<string, number>; // ключ "tag|CC"
}

const SELECT_REASON_PENALTIES = `
  SELECT reason_type AS type, reason_key AS key, SUM(vote) AS net
  FROM feedback
  WHERE chat_id = ? AND reason_type IS NOT NULL
  GROUP BY reason_type, reason_key`;

/** Свёртка дизлайков по корзинам (source/tag/region/pair). Лайки (reason_type NULL) не входят. */
export function selectReasonPenalties(db: Database.Database, chatId: number): ReasonPenalties {
  const rows = db.prepare(SELECT_REASON_PENALTIES).all(chatId) as { type: string; key: string; net: number }[];
  const out: ReasonPenalties = { source: new Map(), tag: new Map(), region: new Map(), pair: new Map() };
  for (const r of rows) {
    const bucket = out[r.type as keyof ReasonPenalties];
    if (bucket !== undefined) bucket.set(r.key, r.net);
  }
  return out;
}
