// Точка запуска процесса.
//
// CLAUDE.md: вся бизнес-логика держится СНАРУЖИ этой точки (в модулях src/*),
// чтобы переход long polling -> webhook был заменой только точки запуска.
// Здесь — только сборка зависимостей (composition root): бот + планировщик (T15).

import type { Bot } from 'grammy';
import { describeConfig, getConfig, resolveLlmConfig, type Config } from './config/index.js';
import { getDb } from './db/connection.js';
import { selectActiveUsers, setLastSent, type UserRow } from './db/users.js';
import { createBot } from './bot/index.js';
import { createLogger, type Logger } from './log/index.js';
import { createLLMClient, type LLMClient } from './llm/index.js';
import { collectCandidates } from './sources/collect.js';
import { resolveCandidates } from './sources/resolve.js';
import { persistCandidates } from './sources/persist.js';
import { enrichPending } from './enrich/index.js';
import { clusterPending } from './cluster/index.js';
import { scoreForUser } from './score/index.js';
import { renderPairs } from './render/index.js';
import { buildUserCards } from './card/index.js';
import type { CardMessage } from './card/compose.js';
import { createSendQueue } from './send/queue.js';
import { sendUserCards } from './send/index.js';
import { runRetention } from './db/retention.js';
import {
  runGlobalPass,
  runDispatchTick,
  startScheduler,
  type SchedulerHandle,
} from './scheduler/index.js';
import type { Database } from 'better-sqlite3';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Поднимает планировщик (T15) рядом с ботом: глобальный проход (collect→enrich→cluster) на
 * своём интервале + тик окон (per-user рендер→карточки→отправка). Один LLM-клиент на обе роли
 * (default/render — модель выбирается по роли внутри клиента).
 *
 * Fail-soft: если LLM не сконфигурирован (нет провайдера/ключа), планировщик НЕ стартует, а
 * бот остаётся живым для онбординга/команд — чтобы misconfig не валил весь процесс.
 */
async function startSchedulerForBot(
  db: Database,
  bot: Bot,
  config: Config,
  logger: Logger,
): Promise<SchedulerHandle | undefined> {
  let llm: LLMClient;
  try {
    llm = await createLLMClient(resolveLlmConfig(process.env), { logger });
  } catch (err) {
    logger.warn('scheduler disabled: LLM не сконфигурирован (бот работает для онбординга/команд)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  const queue = createSendQueue({
    globalRps: config.SEND_GLOBAL_RPS,
    perChatRps: config.SEND_PER_CHAT_RPS,
  });

  // Реальный send-адаптер: CardMessage → bot.api.sendMessage (T14: replyMarkup→reply_markup,
  // disableWebPagePreview→link_preview_options). 429/5xx ретраит autoRetry на bot.api (см. createBot).
  const send = (chatId: number, msg: CardMessage): Promise<unknown> =>
    bot.api.sendMessage(chatId, msg.text, {
      parse_mode: msg.parseMode,
      link_preview_options: { is_disabled: msg.disableWebPagePreview },
      reply_markup: msg.replyMarkup,
    });

  const runGlobal = (): Promise<void> =>
    runGlobalPass({
      logger,
      collect: async () => {
        // Порядок (design.md): сбор → резолв обёрток GN → канонизация/дедуп (persist).
        const collected = await collectCandidates(db, {
          logger,
          includeGn: config.GOOGLE_NEWS_ENABLED,
        });
        const resolved = await resolveCandidates(collected, { logger });
        persistCandidates(db, resolved, { logger });
      },
      enrich: async () => {
        await enrichPending(db, llm, {
          maxBatch: config.MAX_ENRICH_BATCH,
          runCap: config.ENRICH_RUN_CAP,
          logger,
        });
      },
      cluster: async () => {
        await clusterPending(db, {
          windowMs: config.CLUSTER_WINDOW_HOURS * HOUR_MS,
          runCap: config.CLUSTER_RUN_CAP,
          logger,
        });
      },
    });

  const scoreWindowMs = config.SCORE_WINDOW_HOURS * HOUR_MS;
  const processUser = async (user: UserRow): Promise<void> => {
    const now = Date.now();
    const scored = scoreForUser(db, user, now, { windowMs: scoreWindowMs });
    if (scored.length === 0) return; // пустой дайджест → ничего не шлём (окно закроет тик)
    // Demand-driven рендер недостающих саммари (кеш по (cluster, lang) переиспользуется языком).
    const pairs = scored.map((s) => ({ clusterId: s.clusterId, lang: user.lang }));
    await renderPairs(db, llm, pairs, { maxOutputTokens: config.RENDER_MAX_OUTPUT_TOKENS, logger });
    const cards = buildUserCards(db, user, scored, { calibrationCards: config.CALIBRATION_CARDS });
    if (cards.length === 0) return;
    await sendUserCards({ db, queue, send, now: () => Date.now(), logger }, user, cards);
  };

  const runDispatch = async (): Promise<void> => {
    await runDispatchTick({
      now: () => Date.now(),
      logger,
      listActiveUsers: () => selectActiveUsers(db),
      processUser,
      markWindowServed: (chatId, boundaryMs) => setLastSent(db, chatId, boundaryMs),
    });
  };

  // Ретенция БД: горизонт RETENTION_DAYS, daily-тик (вычисление вне точки запуска — CLAUDE.md).
  // runRetention синхронный (better-sqlite3) — оборачиваем в Promise для единого контракта тиков.
  const runMaintenance = (): Promise<void> => {
    const res = runRetention(db, Date.now(), config.RETENTION_DAYS * DAY_MS);
    logger.info('retention done', { clusters: res.clusters, articles: res.articles });
    return Promise.resolve();
  };

  return startScheduler({
    logger,
    runGlobalPass: runGlobal,
    runDispatch,
    runMaintenance,
    tickIntervalMs: config.TICK_INTERVAL_MIN * MINUTE_MS,
    globalPassIntervalMs: config.GLOBAL_PASS_INTERVAL_MIN * MINUTE_MS,
    maintenanceIntervalMs: DAY_MS,
  });
}

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger('main');
  logger.info('config loaded', describeConfig(config));

  const db = getDb();
  const bot = createBot(config.TELEGRAM_BOT_TOKEN, { db, now: () => Date.now() }, config.MAX_USERS);

  const scheduler = await startSchedulerForBot(db, bot, config, logger);

  const shutdown = (): void => {
    scheduler?.stop();
    void bot.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('starting long polling');
  await bot.start();
}

void main();
