import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { createSessionStore } from './session.js';
import { createStartLimiter, START_COOLDOWN_MS } from './safeguard.js';
import { registerCommands, setBotCommands } from './commands.js';
import { registerSettings } from './settings.js';
import { registerFeedback } from './feedback.js';
import { registerOnboarding, type BotDeps } from './onboarding/handler.js';
import type { Wizard } from './wizard.js';

/**
 * Собирает grammY-бота: middleware, хендлеры команд/онбординга/настроек, обработчик ошибок.
 * НЕ вызывает .start() — запуск делает точка входа src/index.ts (переход на webhook = замена
 * только точки запуска, без изменения хендлеров/логики).
 */
export function createBot(token: string, deps: BotDeps, maxUsers: number): Bot {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry()); // retry/backoff на Telegram 429/5xx (CLAUDE.md); полная троттл-очередь — T13

  const store = createSessionStore<Wizard>();
  const limiter = createStartLimiter(START_COOLDOWN_MS, () => deps.now());

  // ПОРЯДОК ВАЖЕН: команды первыми; затем registerOnboarding ПЕРЕД registerSettings —
  // онбординг-хендлеры ob~*/message:text идут первыми и зовут next() дальше к settings,
  // когда чат в режиме settings. Обратный порядок дал бы settings проглатывать
  // мид-онбординговые обновления.
  registerCommands(bot, store, deps, { maxUsers, limiter });
  registerOnboarding(bot, store, deps);
  registerSettings(bot, store, deps);
  // Кнопки 👍/👎 (T14): префикс fb~ независим от ob~/set~/del~, порядок регистрации не важен.
  registerFeedback(bot, deps);

  bot.catch((err) => {
    // Структурный лог без секретов/PII: только тип ошибки.
    console.error('bot error', { name: err.error instanceof Error ? err.error.name : 'unknown' });
  });

  void setBotCommands(bot).catch(() => {
    /* setMyCommands не критичен для запуска */
  });

  return bot;
}
