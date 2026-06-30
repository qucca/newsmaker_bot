import type { UserRow } from '../db/users.js';
import { createLogger, type Logger } from '../log/index.js';
import { latestDueWindow } from './windows.js';

// Планировщик (T15). Два разных таймера: глобальный проход (вычисление контента) и тик
// окон (отправка) — «вычисление разведено с отправкой» (design.md «Расписание»).
// НЕ cron-на-юзера: один тик перебирает активных юзеров. Состояние расписания —
// users.last_sent_at (переживает рестарты), отдельной таблицы нет.

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Уступаем event loop между юзерами (синхронный better-sqlite3 не должен подвешивать команды). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── Глобальный проход (collect → enrich → cluster) ──────────────────────────

export interface GlobalPassDeps {
  logger?: Logger;
  collect: () => Promise<void>; // сбор L1 + персист кандидатов (T4–T5)
  enrich: () => Promise<void>; // обогащение (T7)
  cluster: () => Promise<void>; // кластеризация (T8)
}

/**
 * Один прогон глобального прохода. Шаги изолированы: сбой одного логируется и не блокирует
 * следующие (enrich дообработает накопленное в следующий раз; cluster идёт по уже
 * обогащённым). Идёт ДО окон, наполняет clusters/summaries-вход.
 */
export async function runGlobalPass(deps: GlobalPassDeps): Promise<void> {
  const logger = deps.logger ?? createLogger('scheduler');
  const steps: Array<[string, () => Promise<void>]> = [
    ['collect', deps.collect],
    ['enrich', deps.enrich],
    ['cluster', deps.cluster],
  ];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (err) {
      logger.error('global pass step failed', { step: label, error: errMsg(err) });
    }
  }
}

// ── Тик окон (per-user отправка дайджеста) ──────────────────────────────────

export interface DispatchDeps {
  now: () => number;
  logger?: Logger;
  listActiveUsers: () => UserRow[];
  /** Обработка одного due-юзера: score→render→карточки→отправка. Best-effort (изолируется). */
  processUser: (user: UserRow) => Promise<void>;
  /** Закрывает окно: двигает last_sent_at на границу окна (epoch ms). */
  markWindowServed: (chatId: number, boundaryMs: number) => void;
}

export interface DispatchResult {
  considered: number; // сколько активных юзеров перебрали
  due: number; // сколько попали в окно и обработаны
}

/**
 * Один тик окон. Для каждого активного юзера: попал ли в окно (последняя пройденная сегодня
 * граница из tz + reading_windows) и не обслужено ли оно уже (last_sent_at < границы).
 * Due-юзера обрабатываем и ЗАКРЫВАЕМ окно (двигаем last_sent_at на границу) — даже если
 * дайджест пуст или обработка упала: одно окно = одна попытка (решения T15).
 */
export async function runDispatchTick(deps: DispatchDeps): Promise<DispatchResult> {
  const logger = deps.logger ?? createLogger('scheduler');
  const now = deps.now();
  const users = deps.listActiveUsers();
  let due = 0;

  for (const user of users) {
    const boundary = latestDueWindow(user.readingWindows, user.tz, now);
    if (boundary === null) continue;
    if (!(user.lastSentAt === null || user.lastSentAt < boundary)) continue;

    due++;
    try {
      await deps.processUser(user);
    } catch (err) {
      logger.error('dispatch: user processing failed', {
        chatId: user.chatId,
        error: errMsg(err),
      });
    }
    deps.markWindowServed(user.chatId, boundary);
    await yieldToEventLoop();
  }

  logger.info('dispatch tick done', { considered: users.length, due });
  return { considered: users.length, due };
}

// ── Запуск таймеров ─────────────────────────────────────────────────────────

/**
 * Оборачивает async-задачу защитой от наложения: пока предыдущий запуск не завершился,
 * повторный тик пропускается (better-sqlite3 + LLM могут идти дольше интервала). Сбой
 * задачи логируется и сбрасывает флаг (следующий тик пойдёт).
 */
export function guardedRunner(
  fn: () => Promise<void>,
  logger: Logger,
  label: string,
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      logger.warn('scheduler tick skipped: previous still running', { tick: label });
      return;
    }
    running = true;
    try {
      await fn();
    } catch (err) {
      logger.error('scheduler tick failed', { tick: label, error: errMsg(err) });
    } finally {
      running = false;
    }
  };
}

export interface StartSchedulerDeps {
  logger?: Logger;
  runGlobalPass: () => Promise<void>;
  runDispatch: () => Promise<void>;
  runMaintenance: () => Promise<void>; // ретенция БД (daily) — НЕ cron-на-юзера
  tickIntervalMs: number;
  globalPassIntervalMs: number;
  maintenanceIntervalMs: number;
}

export interface SchedulerHandle {
  stop: () => void;
}

/**
 * Заводит три таймера (глобальный проход, тик окон, ретенция БД) с защитой от наложения.
 * Глобальный проход и ретенция прогоняются один раз сразу при старте (прогрев контента /
 * чистка переживает частые рестарты, на которых daily-таймер сбрасывается), дальше — по
 * интервалу. stop() гасит все таймеры.
 */
export function startScheduler(deps: StartSchedulerDeps): SchedulerHandle {
  const logger = deps.logger ?? createLogger('scheduler');
  const runGlobal = guardedRunner(deps.runGlobalPass, logger, 'global-pass');
  const runDispatch = guardedRunner(deps.runDispatch, logger, 'dispatch');
  const runMaintenance = guardedRunner(deps.runMaintenance, logger, 'maintenance');

  void runGlobal(); // прогрев: наполнить контент сразу, не ждать первого интервала
  void runMaintenance(); // ретенция при старте: daily-таймер иначе не сработает при частых рестартах
  const gTimer = setInterval(() => void runGlobal(), deps.globalPassIntervalMs);
  const dTimer = setInterval(() => void runDispatch(), deps.tickIntervalMs);
  const mTimer = setInterval(() => void runMaintenance(), deps.maintenanceIntervalMs);

  logger.info('scheduler started', {
    tickIntervalMs: deps.tickIntervalMs,
    globalPassIntervalMs: deps.globalPassIntervalMs,
    maintenanceIntervalMs: deps.maintenanceIntervalMs,
  });

  return {
    stop: () => {
      clearInterval(gTimer);
      clearInterval(dTimer);
      clearInterval(mTimer);
      logger.info('scheduler stopped');
    },
  };
}
