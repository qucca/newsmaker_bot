// Точка запуска процесса.
//
// CLAUDE.md: вся бизнес-логика держится СНАРУЖИ этой точки (в модулях src/*),
// чтобы переход long polling -> webhook был заменой только точки запуска.

import { describeConfig, getConfig } from './config/index.js';
import { getDb } from './db/connection.js';
import { createBot } from './bot/index.js';

async function main(): Promise<void> {
  const config = getConfig();
  console.log('news_bot: config loaded', describeConfig(config));

  const db = getDb();
  const bot = createBot(config.TELEGRAM_BOT_TOKEN, { db, now: () => Date.now() }, config.MAX_USERS);

  const shutdown = (): void => { void bot.stop(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log('news_bot: starting long polling');
  await bot.start();
}

void main();
