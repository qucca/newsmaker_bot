import type Database from 'better-sqlite3';

// Репозиторий фидбэка (T14). «Глупый» SQL без доменной логики. Сигнал — структурированный:
// один голос на (chat_id, cluster_id), переголос перезаписывает. source денормализован
// (издание представителя) — основа свёртки штрафа по источнику (читает T10, src/db/score.ts).
// Task 2.3: причина (reason_type/reason_key) — типизированный тег причины дизлайка.

export type ReasonType = 'pair' | 'tag' | 'region' | 'source';

export interface FeedbackInput {
  chatId: number;
  clusterId: number;
  vote: 1 | -1;
  source: string;
  reasonType: ReasonType | null;
  reasonKey: string | null;
  now: number;
}

const UPSERT_FEEDBACK = `
  INSERT INTO feedback (chat_id, cluster_id, vote, source, reason_type, reason_key, created_at)
  VALUES (@chatId, @clusterId, @vote, @source, @reasonType, @reasonKey, @now)
  ON CONFLICT (chat_id, cluster_id)
  DO UPDATE SET vote = excluded.vote, source = excluded.source,
    reason_type = excluded.reason_type, reason_key = excluded.reason_key, created_at = excluded.created_at`;

/** Пишет/перезаписывает голос юзера за кластер (переголос). */
export function recordFeedback(db: Database.Database, fb: FeedbackInput): void {
  db.prepare(UPSERT_FEEDBACK).run(fb);
}

const SELECT_VOTE = `SELECT vote FROM feedback WHERE chat_id = ? AND cluster_id = ?`;

/** Текущий голос юзера за кластер (для решения «перерисовывать ли клавиатуру»). */
export function getFeedbackVote(
  db: Database.Database,
  chatId: number,
  clusterId: number,
): 1 | -1 | undefined {
  const row = db.prepare(SELECT_VOTE).get(chatId, clusterId) as { vote: number } | undefined;
  return row === undefined ? undefined : (row.vote as 1 | -1);
}
