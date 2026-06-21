// Универсальный retry с экспоненциальным backoff + джиттером.
// Используется при фетче фидов (сеть/таймаут/5xx — ретраебельны, 4xx — нет).

export interface RetryOptions {
  /** Число дополнительных попыток после первой (всего попыток = maxRetries + 1). */
  maxRetries: number;
  /** Решает, стоит ли ретраить ошибку. По умолчанию ретраебельно всё. */
  isRetryable?: (error: unknown) => boolean;
  /** База для экспоненциального backoff (мс). */
  baseDelayMs?: number;
  /** Инъекция сна — детерминирует тесты (в проде по умолчанию setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** HTTP-статусы, которые имеет смысл ретраить: 5xx и временные 408/429. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** Верхняя граница задержки для попытки (мс): base * 2^attempt. Джиттер берётся от неё. */
export function backoffCeilingMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

/**
 * Выполняет fn с ретраями. attempt передаётся в fn (0-based). Между попытками ждёт
 * случайную задержку в пределах экспоненциального потолка (full jitter).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    isRetryable = (): boolean => true,
    baseDelayMs = 500,
    sleep = defaultSleep,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryable(error)) break;
      const ceiling = backoffCeilingMs(attempt, baseDelayMs);
      await sleep(Math.round(Math.random() * ceiling));
    }
  }
  throw lastError;
}
