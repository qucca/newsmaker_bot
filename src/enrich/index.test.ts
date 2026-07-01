import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { insertArticles, selectUnenriched, type ArticleInsert } from '../db/articles.js';
import { createClient } from '../llm/index.js';
import { createFakeAdapter } from '../llm/providers/fake.js';
import type { ProviderResult } from '../llm/types.js';
import type { Logger } from '../log/index.js';
import { enrichPending, resolveEnrichClient } from './index.js';

const silent: Logger = { info() {}, warn() {}, error() {} };

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function art(over: Partial<ArticleInsert> = {}): ArticleInsert {
  return {
    canonicalUrl: 'https://e.com/a',
    source: 'e.com',
    feedSourceId: null,
    lang: 'en',
    title: 'Title',
    publishedAt: null,
    fetchedAt: 1,
    description: 'desc',
    ...over,
  };
}

function okItem(ref: number) {
  return {
    ref,
    entities: ['NATO', 'Ukraine'],
    tags: ['world_geopolitics'],
    quality: 70,
    is_urgent: false,
    is_major: true,
    neutral_facts: ['Fact one.', 'Fact two.'],
  };
}

function result(raw: unknown): ProviderResult {
  return { raw, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-model' };
}

function fakeClient(results: ProviderResult[]) {
  return createClient(createFakeAdapter({ results }), { logger: silent });
}

test('enrichPending: обогащает чанк, пишет поля и cluster_key', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  const id = selectUnenriched(db, 10)[0].id;
  const llm = fakeClient([result([okItem(0)])]);

  const res = await enrichPending(db, llm, { logger: silent, now: () => 9000 });
  assert.deepEqual(res, { selected: 1, enriched: 1, skipped: 0 });

  const r = db
    .prepare(`SELECT enriched_at, cluster_key, quality, is_major FROM articles WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  assert.equal(r.enriched_at, 9000);
  assert.equal(r.cluster_key, 'nato|ukraine');
  assert.equal(r.quality, 70);
  assert.equal(r.is_major, 1);
  db.close();
});

test('enrichPending: не-массив в ответе → LlmSchemaError → чанк пропущен', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  // оба ответа не массив → не проходят z.array(z.unknown()) → LlmSchemaError после ретрая
  const llm = fakeClient([result({ oops: true }), result({ oops: true })]);

  const res = await enrichPending(db, llm, { logger: silent });
  assert.deepEqual(res, { selected: 1, enriched: 0, skipped: 1 });
  assert.equal(selectUnenriched(db, 10).length, 1); // не обогащена → дообработается позже
  db.close();
});

test('enrichPending: частичный батч — лишний/битый объект отброшен, валидные записаны', async () => {
  const db = memDb();
  insertArticles(db, [
    art({ canonicalUrl: 'https://e.com/a' }),
    art({ canonicalUrl: 'https://e.com/b' }),
  ]);
  // refs=[0,1]: валидный 0, битый 1 (тег вне словаря), лишний 9 — оставить только 0
  const badItem = { ...okItem(1), tags: ['nonsense'] };
  const llm = fakeClient([result([okItem(0), badItem, okItem(9)])]);

  const res = await enrichPending(db, llm, { logger: silent });
  assert.deepEqual(res, { selected: 2, enriched: 1, skipped: 1 });
  const stillPending = selectUnenriched(db, 10);
  assert.equal(stillPending.length, 1); // статья b осталась необогащённой → дообработается позже
  db.close();
});

test('enrichPending: идемпотентность — повторный прогон ничего не выбирает', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  const llm = fakeClient([result([okItem(0)])]);
  await enrichPending(db, llm, { logger: silent });

  const llm2 = fakeClient([]); // очередь пуста — но и вызовов быть не должно
  const res = await enrichPending(db, llm2, { logger: silent });
  assert.deepEqual(res, { selected: 0, enriched: 0, skipped: 0 });
  db.close();
});

test('enrichPending: бьёт на чанки по maxBatch', async () => {
  const db = memDb();
  insertArticles(db, [
    art({ canonicalUrl: 'https://e.com/a' }),
    art({ canonicalUrl: 'https://e.com/b' }),
    art({ canonicalUrl: 'https://e.com/c' }),
  ]);
  // maxBatch=2 → чанки [a,b] и [c]; refs локальные: [0,1] и [0]
  const llm = fakeClient([result([okItem(0), okItem(1)]), result([okItem(0)])]);
  const res = await enrichPending(db, llm, { logger: silent, maxBatch: 2 });
  assert.deepEqual(res, { selected: 3, enriched: 3, skipped: 0 });
  db.close();
});

test('resolveEnrichClient: fail-fast при отсутствии LLM_PROVIDER', async () => {
  await assert.rejects(() => resolveEnrichClient(silent, {}));
});
