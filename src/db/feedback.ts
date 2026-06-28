import type Database from 'better-sqlite3';

// Репозиторий фидбэка (T14). «Глупый» SQL без доменной логики. Сигнал — структурированный:
// один голос на (chat_id, cluster_id), переголос перезаписывает. source денормализован
// (издание представителя) — основа свёртки штрафа по источнику (читает T10, src/db/score.ts).

export interface FeedbackInput {
  chatId: number;
  clusterId: number;
  vote: 1 | -1;
  source: string;
  now: number;
}

const UPSERT_FEEDBACK = `
  INSERT INTO feedback (chat_id, cluster_id, vote, source, created_at)
  VALUES (@chatId, @clusterId, @vote, @source, @now)
  ON CONFLICT (chat_id, cluster_id)
  DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`;

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
