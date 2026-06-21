import { buildConditionalHeaders, extractConditionalGet } from './conditional-get.js';
import { parseFeed, toCandidate } from './parse.js';
import { isRetryableStatus, withRetry } from './retry.js';
import type { RawCandidate, SourceRow } from './types.js';

// Фетч одного фида с conditional GET, таймаутом и retry/backoff. HTTP делаем сами
// (а не rss-parser.parseURL), чтобы выставлять If-None-Match/If-Modified-Since и читать
// ETag/Last-Modified из ответа. Тело отдаём в parseFeed.

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

/** Результат фетча фида. not-modified — сервер ответил 304, кандидатов нет. */
export interface FeedFetchResult {
  status: 'ok' | 'not-modified';
  candidates: RawCandidate[];
  etag: string | null;
  lastModified: string | null;
}

export interface FetchFeedDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

/** Ошибка ретраебельного HTTP-статуса — бросаем внутри retry, чтобы вызвать повтор. */
class RetryableHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'RetryableHttpError';
  }
}

/** Ретраим: ретраебельные статусы, сетевые ошибки (TypeError) и таймаут/abort. */
function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  if (error instanceof TypeError) return true; // fetch failed (сеть/DNS)
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }
  return false;
}

export async function fetchFeed(
  source: SourceRow,
  deps: FetchFeedDeps = {},
): Promise<FeedFetchResult> {
  const {
    fetchImpl = fetch,
    sleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs,
  } = deps;

  const headers = buildConditionalHeaders({ etag: source.etag, lastModified: source.lastModified });

  const response = await withRetry(
    async () => {
      const res = await fetchImpl(source.url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (isRetryableStatus(res.status)) throw new RetryableHttpError(res.status);
      return res;
    },
    { maxRetries, isRetryable: isRetryableError, sleep, baseDelayMs },
  );

  if (response.status === 304) {
    return {
      status: 'not-modified',
      candidates: [],
      etag: source.etag,
      lastModified: source.lastModified,
    };
  }

  if (!response.ok) {
    throw new Error(`feed ${source.url} responded ${response.status}`);
  }

  const xml = await response.text();
  const items = await parseFeed(xml);
  const candidates = items
    .map((item) => toCandidate(item, source))
    .filter((candidate): candidate is RawCandidate => candidate !== null);
  const cg = extractConditionalGet(response.headers);

  return { status: 'ok', candidates, etag: cg.etag, lastModified: cg.lastModified };
}
