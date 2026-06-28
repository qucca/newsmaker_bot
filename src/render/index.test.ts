import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { getSummary, upsertSummary } from '../db/summaries.js';
import { createClient } from '../llm/index.js';
import { createFakeAdapter } from '../llm/providers/fake.js';
import type { ProviderResult } from '../llm/types.js';
import type { Logger } from '../log/index.js';
import { getOrRenderSummary, renderPairs, resolveRenderClient } from './index.js';

const silent: Logger = { info() {}, warn() {}, error() {} };

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedCluster(
  db: Database.Database,
  over: Partial<{ neutralFacts: string | null; contentHash: string | null }> = {},
): number {
  const info = db
    .prepare(
      `INSERT INTO clusters (cluster_key, entities, neutral_facts, content_hash, first_seen, updated_at)
       VALUES ('k', '["NATO"]', @neutralFacts, @contentHash, 1, 1)`,
    )
    .run({
      neutralFacts: 'neutralFacts' in over ? over.neutralFacts : '["Fact one.","Fact two."]',
      contentHash: 'contentHash' in over ? over.contentHash : 'h1',
    });
  return Number(info.lastInsertRowid);
}

function result(raw: unknown): ProviderResult {
  return { raw, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-model' };
}

function fakeClient(results: ProviderResult[]) {
  return createClient(createFakeAdapter({ results }), { logger: silent });
}

const okCard = { title: 'Заголовок', summary: 'Кратко о событии.' };

test('getOrRenderSummary: miss → рендер и запись в summaries', async () => {
  const db = memDb();
  const id = seedCluster(db);
  const llm = fakeClient([result(okCard)]);

  const out = await getOrRenderSummary(db, llm, id, 'ru', { logger: silent, now: () => 5 });
  assert.deepEqual(out, { status: 'rendered', summary: okCard });
  assert.deepEqual(getSummary(db, id, 'ru'), {
    title: 'Заголовок',
    summary: 'Кратко о событии.',
    contentHash: 'h1',
  });
  db.close();
});

test('getOrRenderSummary: cache hit при совпадении content_hash → без вызова LLM', async () => {
  const db = memDb();
  const id = seedCluster(db);
  upsertSummary(db, {
    clusterId: id,
    lang: 'ru',
    title: 'T',
    summary: 'S',
    contentHash: 'h1',
    model: 'm',
    createdAt: 1,
  });
  const llm = fakeClient([]); // любой вызов LLM исчерпает очередь → throw

  const out = await getOrRenderSummary(db, llm, id, 'ru', { logger: silent });
  assert.deepEqual(out, { status: 'cached', summary: { title: 'T', summary: 'S' } });
  db.close();
});

test('getOrRenderSummary: stale (content_hash разошёлся) → перерендер и upsert', async () => {
  const db = memDb();
  const id = seedCluster(db, { contentHash: 'h2' });
  upsertSummary(db, {
    clusterId: id,
    lang: 'ru',
    title: 'old',
    summary: 'old',
    contentHash: 'h1',
    model: 'm',
    createdAt: 1,
  });
  const llm = fakeClient([result(okCard)]);

  const out = await getOrRenderSummary(db, llm, id, 'ru', { logger: silent, now: () => 9 });
  assert.equal(out.status, 'rendered');
  assert.deepEqual(getSummary(db, id, 'ru'), {
    title: 'Заголовок',
    summary: 'Кратко о событии.',
    contentHash: 'h2',
  });
  db.close();
});

test('getOrRenderSummary: NULL-факты → skipped без вызова LLM', async () => {
  const db = memDb();
  const id = seedCluster(db, { neutralFacts: null, contentHash: null });
  const llm = fakeClient([]); // вызова быть не должно

  const out = await getOrRenderSummary(db, llm, id, 'ru', { logger: silent });
  assert.deepEqual(out, { status: 'skipped' });
  db.close();
});

test('getOrRenderSummary: провал схемы (после ретрая) пробрасывается', async () => {
  const db = memDb();
  const id = seedCluster(db);
  const llm = fakeClient([result({}), result({})]); // оба невалидны → LlmSchemaError
  await assert.rejects(() => getOrRenderSummary(db, llm, id, 'ru', { logger: silent }));
  db.close();
});

test('renderPairs: считает rendered/cached/skipped, изолирует сбой пары', async () => {
  const db = memDb();
  const idA = seedCluster(db); // рендер
  const idB = seedCluster(db); // кеш
  upsertSummary(db, {
    clusterId: idB,
    lang: 'ru',
    title: 'T',
    summary: 'S',
    contentHash: 'h1',
    model: 'm',
    createdAt: 1,
  });
  const idC = seedCluster(db, { neutralFacts: null, contentHash: null }); // skip (NULL-факты)

  const llm = fakeClient([result(okCard)]); // ровно один вызов — для idA
  const res = await renderPairs(
    db,
    llm,
    [
      { clusterId: idA, lang: 'ru' },
      { clusterId: idB, lang: 'ru' },
      { clusterId: idC, lang: 'ru' },
    ],
    { logger: silent, now: () => 7 },
  );
  assert.deepEqual(res, { rendered: 1, cached: 1, skipped: 1 });
  db.close();
});

test('getOrRenderSummary: maxOutputTokens из deps доходит до адаптера; дефолт 800', async () => {
  const db = memDb();

  const id1 = seedCluster(db);
  const adapter1 = createFakeAdapter({ results: [result(okCard)] });
  const llm1 = createClient(adapter1, { logger: silent });
  await getOrRenderSummary(db, llm1, id1, 'ru', { logger: silent, maxOutputTokens: 1234 });
  assert.equal(adapter1.calls[0].maxOutputTokens, 1234);

  const id2 = seedCluster(db);
  const adapter2 = createFakeAdapter({ results: [result(okCard)] });
  const llm2 = createClient(adapter2, { logger: silent });
  await getOrRenderSummary(db, llm2, id2, 'en', { logger: silent });
  assert.equal(adapter2.calls[0].maxOutputTokens, 800);

  db.close();
});

test('resolveRenderClient: fail-fast при отсутствии LLM_PROVIDER', async () => {
  await assert.rejects(() => resolveRenderClient(silent, {}));
});
