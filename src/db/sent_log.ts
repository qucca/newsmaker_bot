import type Database from 'better-sqlite3';

// Репозиторий журнала отправки (T13). Ключ (chat_id, cluster_id) = дедуп ПО КЛАСТЕРУ.
// Пишется сразу после ack Telegram (идемпотентность). «Глупый» SQL, без доменной логики.

const INSERT_SENT = `
  INSERT INTO sent_log (chat_id, cluster_id, kind, sent_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (chat_id, cluster_id) DO NOTHING`;

/** Идемпотентно фиксирует факт отправки кластера юзеру. Повтор — no-op. */
export function insertSent(
  db: Database.Database,
  chatId: number,
  clusterId: number,
  kind: 'digest' | 'urgent',
  sentAt: number,
): void {
  db.prepare(INSERT_SENT).run(chatId, clusterId, kind, sentAt);
}

const COUNT_SENT = `SELECT COUNT(*) AS n FROM sent_log WHERE chat_id = ?`;

/** Сколько кластеров всего отправлено юзеру (гейт калибровки кнопок фидбэка, T14). */
export function countSentCards(db: Database.Database, chatId: number): number {
  return (db.prepare(COUNT_SENT).get(chatId) as { n: number }).n;
}
