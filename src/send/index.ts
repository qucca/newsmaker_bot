import type Database from 'better-sqlite3';
import { GrammyError } from 'grammy';
import type { UserRow } from '../db/users.js';
import { setUserInactive, incrementCardsSent } from '../db/users.js';
import { insertSent } from '../db/sent_log.js';
import type { UserCard } from '../card/index.js';
import type { CardMessage } from '../card/compose.js';
import { createLogger, type Logger } from '../log/index.js';
import type { SendQueue } from './queue.js';

// T13: per-user отправка шорт-листа карточек через общий троттл. Retry транзиентных
// ошибок (429/5xx) — за autoRetry() на bot.api. Здесь: троттл + sent_log после ack +
// 403→active=0 + skip+log прочих ошибок (один сбой не валит дайджест юзера).

export interface SendDeps {
  db: Database.Database;
  queue: SendQueue;
  /** Отправка сообщения (в проде — обёртка над bot.api.sendMessage). */
  send: (chatId: number, msg: CardMessage) => Promise<unknown>;
  now: () => number;
  logger?: Logger;
}

export interface SendSummary {
  sent: number;
  skipped: number;
  deactivated: boolean;
}

/** true, если ошибка — Telegram 403 (бот заблокирован / юзер деактивирован). */
export function isForbidden(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/**
 * Шлёт карточки юзера последовательно (await каждой → per-chat троттл соблюдается).
 * После ack пишет sent_log. 403 → деактивирует юзера и прекращает отправку ему.
 * Любая иная ошибка → skip+log, остальные карточки идут дальше.
 */
export async function sendUserCards(
  deps: SendDeps,
  user: UserRow,
  cards: UserCard[],
): Promise<SendSummary> {
  const logger = deps.logger ?? createLogger('send');
  let sent = 0;
  let skipped = 0;
  let deactivated = false;

  for (const card of cards) {
    try {
      await deps.queue.enqueue(user.chatId, () => deps.send(user.chatId, card.message));
      // Новая строка sent_log (не дедуп) → инкремент lifetime-счётчика калибровки (T14).
      if (insertSent(deps.db, user.chatId, card.clusterId, 'digest', deps.now())) {
        incrementCardsSent(deps.db, user.chatId);
      }
      sent++;
    } catch (err) {
      if (isForbidden(err)) {
        setUserInactive(deps.db, user.chatId, deps.now());
        deactivated = true;
        logger.warn('user deactivated on 403', { chatId: user.chatId });
        break;
      }
      const code = err instanceof GrammyError ? err.error_code : undefined;
      logger.warn('send card skipped', { clusterId: card.clusterId, code });
      skipped++;
    }
  }

  logger.info('user cards sent', {
    chatId: user.chatId, sent, skipped, deactivated, total: cards.length,
  });
  return { sent, skipped, deactivated };
}
