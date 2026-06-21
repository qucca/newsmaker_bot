import { z } from 'zod';

/** Путь к файлу БД по умолчанию (используется и в схеме, и в getDatabasePath). */
export const DEFAULT_DATABASE_PATH = './data/news_bot.sqlite';

/**
 * Схема переменных окружения.
 *
 * Дополняется по мере задач: feature-специфичные ключи (кап юзеров, рейт-лимиты
 * онбординга, параметры расписания и т.п.) заводятся ВМЕСТЕ со своей фичей, а не
 * наперёд. Держим в синхроне с .env.example.
 */
const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'обязателен (токен от @BotFather)'),
  ANTHROPIC_API_KEY: z.string().min(1, 'обязателен (ключ Anthropic API)'),
  DATABASE_PATH: z.string().min(1).default(DEFAULT_DATABASE_PATH),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = Readonly<z.infer<typeof EnvSchema>>;

/** Поля-секреты: их значения НИКОГДА не попадают в логи и тексты ошибок. */
const SECRET_KEYS: readonly string[] = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY'];

/**
 * Чистый разбор и валидация конфига из произвольного источника (удобно для тестов).
 * При ошибке бросает Error со списком проблем БЕЗ значений — защита секретов.
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}

/**
 * Подгружает ./.env в process.env, если файл есть. Отсутствие файла — не ошибка:
 * вне локальной разработки переменные задаются самим окружением.
 */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env отсутствует — это нормально в проде.
  }
}

let cached: Config | undefined;

/** Загружает и валидирует конфиг один раз (fail-fast при старте), кеширует результат. */
export function getConfig(): Config {
  if (cached === undefined) {
    loadEnvFile();
    cached = parseConfig(process.env);
  }
  return cached;
}

/**
 * Путь к БД без полной валидации конфига: миграциям (`npm run migrate`) нужен только путь,
 * а не секреты (токен/ключ), чтобы команда работала на свежем чекауте и в CI.
 */
export function getDatabasePath(): string {
  loadEnvFile();
  const fromEnv = process.env.DATABASE_PATH;
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_DATABASE_PATH;
}

/**
 * Безопасное для логов представление конфига: значения секретных полей замаскированы.
 * Использовать вместо прямого логирования config.
 */
export function describeConfig(config: Config): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    safe[key] = SECRET_KEYS.includes(key) ? '***' : String(value);
  }
  return safe;
}
