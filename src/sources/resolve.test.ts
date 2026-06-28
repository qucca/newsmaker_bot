import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGoogleNewsUrl,
  extractDecodeSignals,
  parseBatchExecuteUrl,
  buildBatchExecuteBody,
  resolveGoogleNewsUrl,
  resolveCandidates,
} from './resolve.js';
import type { RawCandidate } from './types.js';

// Реальный ответ batchexecute, снятый вживую (2026): garturlres → [url, 1, amp-url].
// Берём индекс [1] (каноничный, не-AMP). Фикстура может протухнуть при смене формата GN.
const BATCH_RESPONSE = `)]}'

[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.aljazeera.com/news/2026/6/28/iran-attacks\\",1,\\"https://www.aljazeera.com/amp/news/2026/6/28/iran-attacks\\"]",null,null,null,"generic"],["di",11],["af.httprm",11,"-3631175162609140718",29]]`;

const WRAPPED = 'https://news.google.com/rss/articles/CBMiabc123?oc=5';
const HTML_WITH_SIGNALS =
  '<c-wiz data-n-a-id="ABC_ID_payload" data-n-a-sg="SIG28chars" data-n-a-ts="1782669935">x</c-wiz>';

function rawGn(link: string): RawCandidate {
  return {
    feedSourceId: 7,
    source: 'news.google.com',
    lang: 'en',
    title: 'T',
    link,
    publishedAt: 1,
    description: null,
  };
}

// ── isGoogleNewsUrl ─────────────────────────────────────────────────────────
test('isGoogleNewsUrl: обёртка GN → true', () => {
  assert.equal(isGoogleNewsUrl('https://news.google.com/rss/articles/CBMi...'), true);
});
test('isGoogleNewsUrl: прямой URL издания → false', () => {
  assert.equal(isGoogleNewsUrl('https://www.bbc.com/news/world-123'), false);
});
test('isGoogleNewsUrl: непарсимое → false', () => {
  assert.equal(isGoogleNewsUrl('not a url'), false);
});

// ── extractDecodeSignals ────────────────────────────────────────────────────
test('extractDecodeSignals: все три атрибута → объект', () => {
  assert.deepEqual(extractDecodeSignals(HTML_WITH_SIGNALS), {
    id: 'ABC_ID_payload',
    sg: 'SIG28chars',
    ts: '1782669935',
  });
});
test('extractDecodeSignals: нет подписи → null', () => {
  assert.equal(extractDecodeSignals('<c-wiz data-n-a-id="x" data-n-a-ts="1">y</c-wiz>'), null);
});

// ── parseBatchExecuteUrl ────────────────────────────────────────────────────
test('parseBatchExecuteUrl: реальный ответ → каноничный URL (не AMP)', () => {
  assert.equal(
    parseBatchExecuteUrl(BATCH_RESPONSE),
    'https://www.aljazeera.com/news/2026/6/28/iran-attacks',
  );
});
test('parseBatchExecuteUrl: мусор → null', () => {
  assert.equal(parseBatchExecuteUrl('garbage not json'), null);
});
test('parseBatchExecuteUrl: нет wrb.fr/Fbv4je → null', () => {
  assert.equal(parseBatchExecuteUrl(')]}\'\n\n[["di",11]]'), null);
});

// ── buildBatchExecuteBody ───────────────────────────────────────────────────
test('buildBatchExecuteBody: f.req с rpcid Fbv4je и сигналами в payload', () => {
  const body = buildBatchExecuteBody({ id: 'THEID', sg: 'THESG', ts: '12345' });
  assert.ok(body.startsWith('f.req='));
  const freq = JSON.parse(decodeURIComponent(body.slice('f.req='.length)));
  assert.equal(freq[0][0][0], 'Fbv4je');
  const inner = JSON.parse(freq[0][0][1]);
  assert.equal(inner[0], 'garturlreq');
  assert.equal(inner[2], 'THEID');
  assert.equal(inner[3], 12345);
  assert.equal(inner[4], 'THESG');
});

// ── resolveGoogleNewsUrl (мок fetch) ────────────────────────────────────────
function mockFetch(handlers: { get?: string; post?: string; fail?: boolean }) {
  return (url: string | URL | Request, opts?: { method?: string }): Promise<Response> => {
    if (handlers.fail) return Promise.reject(new TypeError('network'));
    const isPost = opts?.method === 'POST';
    const body = (isPost ? handlers.post : handlers.get) ?? '';
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(body),
    } as Response);
  };
}
const fastDeps = { maxRetries: 0, timeoutMs: 100, sleep: (): Promise<void> => Promise.resolve() };

test('resolveGoogleNewsUrl: GET сигналы + POST ответ → URL издания', async () => {
  const url = await resolveGoogleNewsUrl(WRAPPED, {
    ...fastDeps,
    fetchImpl: mockFetch({ get: HTML_WITH_SIGNALS, post: BATCH_RESPONSE }),
  });
  assert.equal(url, 'https://www.aljazeera.com/news/2026/6/28/iran-attacks');
});
test('resolveGoogleNewsUrl: нет сигналов на странице → null', async () => {
  const url = await resolveGoogleNewsUrl(WRAPPED, {
    ...fastDeps,
    fetchImpl: mockFetch({ get: '<html>no signals</html>', post: BATCH_RESPONSE }),
  });
  assert.equal(url, null);
});
test('resolveGoogleNewsUrl: сетевой сбой → null (изоляция, не бросает)', async () => {
  const url = await resolveGoogleNewsUrl(WRAPPED, {
    ...fastDeps,
    fetchImpl: mockFetch({ fail: true }),
  });
  assert.equal(url, null);
});

// ── resolveCandidates ───────────────────────────────────────────────────────
test('resolveCandidates: GN-кандидат раскручивается, source = хост издания', async () => {
  const out = await resolveCandidates([rawGn(WRAPPED)], {
    resolve: () => Promise.resolve('https://www.reuters.com/world/article-9'),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].link, 'https://www.reuters.com/world/article-9');
  assert.equal(out[0].source, 'reuters.com');
});
test('resolveCandidates: нерезолвнутый GN-кандидат выкидывается (изоляция)', async () => {
  const out = await resolveCandidates([rawGn(WRAPPED)], {
    resolve: () => Promise.resolve(null),
  });
  assert.equal(out.length, 0);
});
test('resolveCandidates: не-GN кандидат проходит насквозь, resolve не зовётся', async () => {
  let called = false;
  const direct: RawCandidate = { ...rawGn('https://www.bbc.com/news/x'), source: 'bbc.com' };
  const out = await resolveCandidates([direct], {
    resolve: () => {
      called = true;
      return Promise.resolve(null);
    },
  });
  assert.equal(called, false);
  assert.deepEqual(out, [direct]);
});
