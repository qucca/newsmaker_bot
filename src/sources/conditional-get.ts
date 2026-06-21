// Conditional GET (RFC 7232): помогаем фиду отдать 304, если ничего не изменилось.
// Состояние (etag/last-modified) хранится в таблице sources и пишется после каждого
// успешного ответа — см. src/db/sources.ts.

/** Снимок conditional-GET валидаторов из таблицы sources. */
export interface ConditionalGetState {
  etag: string | null;
  lastModified: string | null;
}

/**
 * Заголовки запроса для conditional GET. Ставим только те валидаторы, что у нас есть:
 * If-None-Match (по ETag) и/или If-Modified-Since (по дате). Пустой объект — если фид
 * ещё ни разу не фетчился.
 */
export function buildConditionalHeaders(state: ConditionalGetState): Record<string, string> {
  const headers: Record<string, string> = {};
  if (state.etag) headers['If-None-Match'] = state.etag;
  if (state.lastModified) headers['If-Modified-Since'] = state.lastModified;
  return headers;
}

/** Достаёт свежие валидаторы из заголовков ответа для записи обратно в sources. */
export function extractConditionalGet(headers: Headers): ConditionalGetState {
  return {
    etag: headers.get('etag'),
    lastModified: headers.get('last-modified'),
  };
}
