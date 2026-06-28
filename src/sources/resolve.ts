import { createLogger, type Logger } from '../log/index.js';
import { publisherFromUrl } from './parse.js';
import { isRetryableStatus, withRetry } from './retry.js';
import type { RawCandidate } from './types.js';

// Раскрутка завёрнутых URL Google News (T16). Самая хрупкая зависимость системы (design.md):
// base64-декод обёртки мёртв, HTTP-редирект уводит в consent-флоу — единственный рабочий путь
// (живой зонд 2026) это batchexecute-handshake. Изоляция: любой сбой → null, кандидат
// выкидывается, прогон не падает. Резолвер за интерфейсом resolve(link)->url|null — заменяем
// при смене формата GN. Детерминированные куски (выдирание сигналов, парс ответа, сборка payload)
// покрыты юнит-тестами; фикстуры могут протухнуть — переснять при поломке (см. resolve.test.ts).

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Consent-куки: без них страница обёртки редиректит в consent-флоу (пустое тело, нет сигналов).
const CONSENT_COOKIE = 'CONSENT=YES+cb; SOCS=CAISNggDEitub25l';
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

/** Сигналы со страницы обёртки, нужные для batchexecute-запроса. */
export interface DecodeSignals {
  id: string; // data-n-a-id — payload статьи
  sg: string; // data-n-a-sg — подпись
  ts: string; // data-n-a-ts — таймштамп
}

/** Хост-обёртка Google News? Только такие кандидаты требуют раскрутки. */
export function isGoogleNewsUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.replace(/^www\./, '') === 'news.google.com';
  } catch {
    return false;
  }
}

/** Выдирает id/sg/ts из HTML страницы обёртки. Любого нет → null (сигналов нет — не раскрутить). */
export function extractDecodeSignals(html: string): DecodeSignals | null {
  const id = html.match(/data-n-a-id="([^"]+)"/)?.[1];
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (id === undefined || sg === undefined || ts === undefined) return null;
  return { id, sg, ts };
}

// Конверт запроса garturlreq — дословно из рабочего живого вызова (2026). Не локале-зависим
// (целевая статья закодирована в id); 'US:en' внутри — часть конверта, не язык юзера.
const REQ_ENVELOPE = [
  ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
  'X',
  'X',
  1,
  [1, 1, 1],
  1,
  1,
  null,
  0,
  0,
  null,
  0,
];

/** Тело POST на batchexecute: f.req=<url-encoded RPC garturlreq с сигналами>. */
export function buildBatchExecuteBody(sig: DecodeSignals): string {
  const inner = JSON.stringify(['garturlreq', REQ_ENVELOPE, sig.id, Number(sig.ts), sig.sg]);
  const freq = JSON.stringify([[['Fbv4je', inner, null, 'generic']]]);
  return 'f.req=' + encodeURIComponent(freq);
}

/**
 * Парсит ответ batchexecute → реальный URL издания. Формат: префикс )]}' + чанки;
 * ищем запись wrb.fr/Fbv4je, внутри строкой ["garturlres", "<url>", 1, "<amp>"] — берём [1]
 * (каноничный, не-AMP). Не нашли/мусор → null.
 */
export function parseBatchExecuteUrl(raw: string): string | null {
  const cleaned = raw.replace(/^\)\]\}'/, '');
  for (const line of cleaned.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('[')) continue;
    let arr: unknown;
    try {
      arr = JSON.parse(t);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (
        Array.isArray(entry) &&
        entry[0] === 'wrb.fr' &&
        entry[1] === 'Fbv4je' &&
        typeof entry[2] === 'string'
      ) {
        try {
          const payload: unknown = JSON.parse(entry[2]);
          if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
            return payload[1];
          }
        } catch {
          // повреждённый payload — пробуем следующую запись
        }
      }
    }
  }
  return null;
}

export interface ResolveUrlDeps {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

class RetryableHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'RetryableHttpError';
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  if (error instanceof TypeError) return true; // сеть/DNS
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }
  return false;
}

/** Фетч с таймаутом+retry. Возвращает текст тела или null на не-ретраебельном не-ok. */
async function fetchText(
  url: string,
  init: RequestInit,
  deps: ResolveUrlDeps,
): Promise<string | null> {
  const res = await withRetry(
    async () => {
      const r = await deps.fetchImpl(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs) });
      if (isRetryableStatus(r.status)) throw new RetryableHttpError(r.status);
      return r;
    },
    {
      maxRetries: deps.maxRetries,
      isRetryable: isRetryableError,
      sleep: deps.sleep,
      baseDelayMs: deps.baseDelayMs,
    },
  );
  if (!res.ok) return null;
  return res.text();
}

/**
 * Раскручивает одну обёртку GN в URL издания через batchexecute-handshake. Любой сбой
 * (сеть, нет сигналов, мусорный ответ) → null (изоляция, не бросает).
 */
export async function resolveGoogleNewsUrl(
  wrapped: string,
  deps: Partial<ResolveUrlDeps> = {},
): Promise<string | null> {
  const d: ResolveUrlDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: deps.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseDelayMs: deps.baseDelayMs,
    sleep: deps.sleep,
  };
  try {
    const html = await fetchText(wrapped, { headers: { 'User-Agent': USER_AGENT, Cookie: CONSENT_COOKIE } }, d);
    if (html === null) return null;
    const sig = extractDecodeSignals(html);
    if (sig === null) return null;
    const raw = await fetchText(
      BATCH_URL,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Cookie: CONSENT_COOKIE,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: buildBatchExecuteBody(sig),
      },
      d,
    );
    if (raw === null) return null;
    return parseBatchExecuteUrl(raw);
  } catch {
    return null; // изоляция: нерезолвнутый кандидат не валит прогон
  }
}

export interface ResolveCandidatesDeps {
  resolve: (link: string) => Promise<string | null>;
  logger: Logger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Раскручивает завёрнутые ссылки GN среди кандидатов. GN-обёртка: резолвим, подменяем link и
 * пересчитываем source (издатель = хост раскрученного URL); нерезолвнутые выкидываем (изоляция).
 * Не-GN кандидаты проходят насквозь без изменений. Последовательно + уступаем event loop
 * (не молотим Google, не подвешиваем команды юзеров).
 */
export async function resolveCandidates(
  candidates: RawCandidate[],
  deps: Partial<ResolveCandidatesDeps> = {},
): Promise<RawCandidate[]> {
  const resolve = deps.resolve ?? ((link: string): Promise<string | null> => resolveGoogleNewsUrl(link));
  const logger = deps.logger ?? createLogger('sources');

  const out: RawCandidate[] = [];
  for (const c of candidates) {
    if (!isGoogleNewsUrl(c.link)) {
      out.push(c);
      continue;
    }
    let resolved: string | null = null;
    try {
      resolved = await resolve(c.link);
    } catch (error) {
      logger.warn('gn resolve threw', { feedSourceId: c.feedSourceId, error: errorMessage(error) });
    }
    if (resolved === null) {
      logger.warn('gn candidate dropped: unresolved', { feedSourceId: c.feedSourceId });
    } else {
      out.push({ ...c, link: resolved, source: publisherFromUrl(resolved, c.source) });
    }
    await yieldToEventLoop();
  }
  return out;
}
