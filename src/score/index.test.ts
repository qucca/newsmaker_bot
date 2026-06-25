import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { getUser } from '../db/users.js';
import { scoreForUser } from './index.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedCluster(db: Database.Database, over: Record<string, unknown>): number {
  const v = { tags: '["ai"]', updatedAt: 1000, ...over };
  const info = db
    .prepare(
      `INSERT INTO clusters (cluster_key, tags, quality, is_major, first_seen, updated_at)
       VALUES ('k', @tags, 50, 0, 0, @updatedAt)`,
    )
    .run(v);
  return Number(info.lastInsertRowid);
}

test('scoreForUser: интеграция — окно, дроп zero-overlap, скор, порядок, топ-N', () => {
  const db = memDb();
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, interest_tags, max_items_per_send, created_at, updated_at)
     VALUES (1, 'en', 'UTC', '["ai","crypto"]', 2, 0, 0)`,
  ).run();
  const user = getUser(db, 1);
  assert.ok(user);

  const now = 10_000_000;
  const windowMs = 72 * 3_600_000;
  const fresh = now - 1000;
  const stale = now - windowMs - 1000;

  const c1 = seedCluster(db, { tags: '["ai","crypto"]', updatedAt: fresh }); // overlap 2
  const c2 = seedCluster(db, { tags: '["ai"]', updatedAt: fresh }); // overlap 1
  seedCluster(db, { tags: '["ai","crypto"]', updatedAt: stale }); // вне окна
  seedCluster(db, { tags: '["football"]', updatedAt: fresh }); // zero-overlap

  const out = scoreForUser(db, user, now, { windowMs });
  assert.deepEqual(out.map((c) => c.clusterId), [c1, c2]); // по score, усечено до 2
  assert.equal(out[0].score, 2);
  assert.deepEqual(out[0].matchedTags, ['ai', 'crypto']);
  db.close();
});
