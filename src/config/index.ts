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
  // Провайдер теперь выбираемый (см. resolveLlmConfig) — жёсткая обязательность снята.
  ANTHROPIC_API_KEY: z.string().min(1, 'обязателен (ключ Anthropic API)').optional(),
  DATABASE_PATH: z.string().min(1).default(DEFAULT_DATABASE_PATH),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = Readonly<z.infer<typeof EnvSchema>>;

/** Поля-секреты: их значения НИКОГДА не попадают в логи и тексты ошибок. */
const SECRET_KEYS: readonly string[] = [
  'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY',
];

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

export type LlmProvider = 'anthropic' | 'openai' | 'google';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  models: { default: string; render: string };
}

const PROVIDER_KEY_ENV: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

// Зашитые дефолты есть только у anthropic (зафиксированы в docs/design.md).
const ANTHROPIC_DEFAULT_MODELS = { default: 'claude-haiku-4-5', render: 'claude-sonnet-4-6' };

/** Чистый разбор LLM-конфига из env. fail-fast, значения ключей в ошибки не попадают. */
export function resolveLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const provider = env.LLM_PROVIDER;
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'google') {
    throw new Error(`LLM_PROVIDER: ожидается anthropic | openai | google (получено: ${provider ?? '(пусто)'})`);
  }
  const keyEnv = PROVIDER_KEY_ENV[provider];
  const apiKey = env[keyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`${keyEnv}: обязателен для LLM_PROVIDER=${provider}`);
  }
  const fallback = provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODELS.default : undefined;
  const modelDefault = env.LLM_MODEL_DEFAULT ?? fallback;
  if (modelDefault === undefined || modelDefault.length === 0) {
    throw new Error(`LLM_MODEL_DEFAULT: обязателен для LLM_PROVIDER=${provider}`);
  }
  const renderFallback = provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODELS.render : modelDefault;
  const modelRender = env.LLM_MODEL_RENDER ?? renderFallback;
  return Object.freeze({
    provider,
    apiKey,
    models: Object.freeze({ default: modelDefault, render: modelRender }),
  });
}
