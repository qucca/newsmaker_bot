import type Database from 'better-sqlite3';

// Репозиторий журнала отправки (T13). Ключ (chat_id, cluster_id) = дедуп ПО КЛАСТЕРУ.
// Пишется сразу после ack Telegram (идемпотентность). «Глупый» SQL, без доменной логики.

const INSERT_SENT = `
  INSERT INTO sent_log (chat_id, cluster_id, kind, sent_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (chat_id, cluster_id) DO NOTHING`;

/**
 * Идемпотентно фиксирует факт отправки кластера юзеру. Повтор — no-op.
 * Возвращает true, если строка реально вставлена (не дедуп) — сигнал для инкремента
 * lifetime-счётчика калибровки (чтобы повторная отправка не накручивала счёт).
 */
export function insertSent(
  db: Database.Database,
  chatId: number,
  clusterId: number,
  kind: 'digest' | 'urgent',
  sentAt: number,
): boolean {
  return db.prepare(INSERT_SENT).run(chatId, clusterId, kind, sentAt).changes > 0;
}
