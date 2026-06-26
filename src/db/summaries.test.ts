import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { selectClusterForRender, getSummary, upsertSummary } from './summaries.js';

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

test('selectClusterForRender: маппит neutral_facts/entities/content_hash', () => {
  const db = memDb();
  const id = seedCluster(db);
  assert.deepEqual(selectClusterForRender(db, id), {
    neutralFacts: '["Fact one.","Fact two."]',
    entities: '["NATO"]',
    contentHash: 'h1',
  });
  db.close();
});

test('selectClusterForRender: NULL-факты сохраняются как null', () => {
  const db = memDb();
  const id = seedCluster(db, { neutralFacts: null, contentHash: null });
  const row = selectClusterForRender(db, id);
  assert.equal(row?.neutralFacts, null);
  assert.equal(row?.contentHash, null);
  db.close();
});

test('getSummary: undefined когда строки нет', () => {
  const db = memDb();
  const id = seedCluster(db);
  assert.equal(getSummary(db, id, 'ru'), undefined);
  db.close();
});

test('upsertSummary: вставляет и перезаписывает по (cluster_id, lang)', () => {
  const db = memDb();
  const id = seedCluster(db);
  upsertSummary(db, {
    clusterId: id, lang: 'ru', title: 'T1', summary: 'S1', contentHash: 'h1', model: 'm1', createdAt: 10,
  });
  assert.deepEqual(getSummary(db, id, 'ru'), { title: 'T1', summary: 'S1', contentHash: 'h1' });

  upsertSummary(db, {
    clusterId: id, lang: 'ru', title: 'T2', summary: 'S2', contentHash: 'h2', model: 'm2', createdAt: 20,
  });
  assert.deepEqual(getSummary(db, id, 'ru'), { title: 'T2', summary: 'S2', contentHash: 'h2' });

  const c = db.prepare(`SELECT COUNT(*) AS n FROM summaries WHERE cluster_id = ?`).get(id) as { n: number };
  assert.equal(c.n, 1);
  db.close();
});
