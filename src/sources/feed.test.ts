import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeed } from './feed.js';
import type { SourceRow } from './types.js';

const noSleep = (): Promise<void> => Promise.resolve();

function makeSource(over: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 1,
    kind: 'l1_rss',
    name: 'Example',
    url: 'https://example.com/feed',
    lang: 'en',
    categories: '[]',
    enabled: 1,
    etag: null,
    lastModified: null,
    lastFetchedAt: null,
    ...over,
  };
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ex</title>
<item><title>H1</title><link>https://example.com/a</link><pubDate>Wed, 21 Oct 2015 07:28:00 GMT</pubDate></item>
</channel></rss>`;

// Конструктор Response запрещает null-body статусы (304 и т.п.), поэтому в тестах
// используем Response-подобную заглушку с полями, которые читает fetchFeed.
function fakeResponse(opts: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const { status, body = '', headers = {} } = opts;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

test('fetchFeed: 200 → кандидаты + новые валидаторы из ответа', async () => {
  const fetchImpl = (): Promise<Response> =>
    Promise.resolve(
      fakeResponse({ status: 200, body: RSS, headers: { etag: 'W/"v2"', 'last-modified': 'lm2' } }),
    );
  const res = await fetchFeed(makeSource(), { fetchImpl, sleep: noSleep });
  assert.equal(res.status, 'ok');
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0]?.title, 'H1');
  assert.equal(res.etag, 'W/"v2"');
  assert.equal(res.lastModified, 'lm2');
});

test('fetchFeed: шлёт conditional-заголовки из сохранённого состояния', async () => {
  let sent: Headers | undefined;
  const fetchImpl = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent = new Headers(init?.headers);
    return Promise.resolve(fakeResponse({ status: 304 }));
  };
  await fetchFeed(makeSource({ etag: 'W/"v1"', lastModified: 'lm1' }), {
    fetchImpl,
    sleep: noSleep,
  });
  assert.equal(sent?.get('if-none-match'), 'W/"v1"');
  assert.equal(sent?.get('if-modified-since'), 'lm1');
});

test('fetchFeed: шлёт браузерный User-Agent и Accept (анти-бот-блок, напр. Kommersant 406)', async () => {
  let sent: Headers | undefined;
  const fetchImpl = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent = new Headers(init?.headers);
    return Promise.resolve(fakeResponse({ status: 200, body: RSS }));
  };
  await fetchFeed(makeSource(), { fetchImpl, sleep: noSleep });
  assert.match(sent?.get('user-agent') ?? '', /Mozilla/, 'нет браузерного User-Agent');
  assert.match(sent?.get('accept') ?? '', /xml/, 'Accept без xml');
});

test('fetchFeed: 304 → not-modified, сохраняет прежние валидаторы', async () => {
  const fetchImpl = (): Promise<Response> => Promise.resolve(fakeResponse({ status: 304 }));
  const res = await fetchFeed(makeSource({ etag: 'W/"v1"', lastModified: 'lm1' }), {
    fetchImpl,
    sleep: noSleep,
  });
  assert.equal(res.status, 'not-modified');
  assert.deepEqual(res.candidates, []);
  assert.equal(res.etag, 'W/"v1"');
  assert.equal(res.lastModified, 'lm1');
});

test('fetchFeed: 5xx ретраится, затем успех', async () => {
  let n = 0;
  const fetchImpl = (): Promise<Response> => {
    n++;
    return Promise.resolve(
      n === 1 ? fakeResponse({ status: 503 }) : fakeResponse({ status: 200, body: RSS }),
    );
  };
  const res = await fetchFeed(makeSource(), { fetchImpl, sleep: noSleep, maxRetries: 2 });
  assert.equal(res.status, 'ok');
  assert.equal(n, 2);
});

test('fetchFeed: сетевая ошибка ретраится', async () => {
  let n = 0;
  const fetchImpl = (): Promise<Response> => {
    n++;
    if (n === 1) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(fakeResponse({ status: 200, body: RSS }));
  };
  const res = await fetchFeed(makeSource(), { fetchImpl, sleep: noSleep, maxRetries: 2 });
  assert.equal(res.status, 'ok');
  assert.equal(n, 2);
});

test('fetchFeed: 404 бросает и не ретраит', async () => {
  let n = 0;
  const fetchImpl = (): Promise<Response> => {
    n++;
    return Promise.resolve(fakeResponse({ status: 404 }));
  };
  await assert.rejects(
    fetchFeed(makeSource(), { fetchImpl, sleep: noSleep, maxRetries: 2 }),
    /404/,
  );
  assert.equal(n, 1);
});
