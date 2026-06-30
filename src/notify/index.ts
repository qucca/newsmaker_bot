import { createLogger, type Logger } from '../log/index.js';

// Observability: алерты админу в Telegram + детект «мягкой» деградации пайплайна по стрику
// сбоев. Транспорт инжектируется (обёртка над bot.api.sendMessage) — модуль не зависит от grammY.

export type AdminNotify = (text: string) => Promise<void>;

export interface AdminNotifierDeps {
  adminChatId: number | undefined; // не задан → алерты выключены (только логи)
  send: (chatId: number, text: string) => Promise<unknown>;
  logger?: Logger;
}

/**
 * Алерт админу. Best-effort: chat не задан → no-op; ошибка отправки логируется и НЕ
 * пробрасывается (алерт не должен валить тик/обработчик краша и не рекурсит на своей ошибке).
 */
export function createAdminNotifier(deps: AdminNotifierDeps): AdminNotify {
  const logger = deps.logger ?? createLogger('notify');
  return async (text) => {
    if (deps.adminChatId === undefined) return;
    try {
      await deps.send(deps.adminChatId, text);
    } catch (err) {
      logger.warn('admin notify failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export interface FailureAlerterDeps {
  threshold: number; // сколько подряд сбоев до алерта
  notify: AdminNotify;
  label: string; // что именно сбоит (в тексте алерта)
}

/**
 * Свёртка серии исходов в алерты: ровно один алерт на инцидент (на N-м подряд сбое) и одно
 * «восстановлено» при возврате к успеху. Успех сбрасывает стрик. Защищает от шума на каждый тик.
 */
export function createFailureAlerter(deps: FailureAlerterDeps): (failed: boolean) => Promise<void> {
  let streak = 0;
  let alerted = false;
  return async (failed) => {
    if (failed) {
      streak++;
      if (streak === deps.threshold) {
        alerted = true;
        await deps.notify(`🔴 ${deps.label}: ${streak} сбоя подряд`);
      }
      return;
    }
    if (alerted) {
      alerted = false;
      await deps.notify(`✅ ${deps.label}: восстановлено`);
    }
    streak = 0;
  };
}
