// Точка запуска процесса.
//
// CLAUDE.md: вся бизнес-логика держится СНАРУЖИ этой точки (в модулях src/*),
// чтобы переход long polling -> webhook был заменой только точки запуска,
// без изменения хендлеров и логики.
//
// Реальная инициализация (db, бот, планировщик) появится в следующих задачах.
// Сейчас точка запуска лишь грузит и валидирует конфиг (fail-fast).

import { describeConfig, getConfig } from './config/index.js';

function main(): void {
  const config = getConfig();
  console.log('news_bot: config loaded', describeConfig(config));
}

main();
