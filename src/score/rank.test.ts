import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Category } from '../categories.js';
import type { CandidateRow } from '../db/score.js';
import { rankClusters, parseTags } from './rank.js';

function cand(over: Partial<CandidateRow> & { id: number }): CandidateRow {
  return {
    tags: '[]', quality: 50, isMajor: 0, updatedAt: 1000,
    repArticleId: 1, repSource: 'a.com', sourceCount: 1, ...over,
  };
}

const NONE: ReadonlySet<string> = new Set();
const NOPEN: ReadonlyMap<string, number> = new Map();

test('parseTags: отбрасывает не-словарные слаги и кривой JSON', () => {
  assert.deepEqual(parseTags('["ai","not_a_tag","crypto"]'), ['ai', 'crypto']);
  assert.deepEqual(parseTags('not json'), []);
  assert.deepEqual(parseTags('{}'), []);
});

test('rankClusters: скор = размер пересечения тегов, сортировка по убыванию', () => {
  const cands = [
    cand({ id: 1, tags: '["ai","crypto"]' }),
    cand({ id: 2, tags: '["ai"]' }),
    cand({ id: 3, tags: '["ai","crypto","space"]' }),
  ];
  const out = rankClusters(cands, ['ai', 'crypto', 'space'] as Category[], NONE, NOPEN, 10);
  assert.deepEqual(out.map((c) => c.clusterId), [3, 1, 2]);
  assert.equal(out[0].score, 3);
});

test('rankClusters: zero-overlap кластеры отсеиваются', () => {
  const cands = [cand({ id: 1, tags: '["football"]' }), cand({ id: 2, tags: '["ai"]' })];
  const out = rankClusters(cands, ['ai'] as Category[], NONE, NOPEN, 10);
  assert.deepEqual(out.map((c) => c.clusterId), [2]);
});

test('rankClusters: matchedTags в порядке интересов юзера', () => {
  const cands = [cand({ id: 1, tags: '["crypto","ai"]' })];
  const out = rankClusters(cands, ['ai', 'crypto'] as Category[], NONE, NOPEN, 10);
  assert.deepEqual(out[0].matchedTags, ['ai', 'crypto']);
});

test('rankClusters: кластер с заблокированным источником представителя отсеивается', () => {
  const cands = [
    cand({ id: 1, tags: '["ai"]', repSource: 'bad.com' }),
    cand({ id: 2, tags: '["ai"]', repSource: 'good.com' }),
  ];
  const out = rankClusters(cands, ['ai'] as Category[], new Set(['bad.com']), NOPEN, 10);
  assert.deepEqual(out.map((c) => c.clusterId), [2]);
});

test('rankClusters: дизлайки источника снижают скор, лайки не бустят', () => {
  const cands = [
    cand({ id: 1, tags: '["ai","crypto"]', repSource: 'disliked.com' }),
    cand({ id: 2, tags: '["ai"]', repSource: 'liked.com' }),
  ];
  const penalties = new Map([
    ['disliked.com', -3],
    ['liked.com', 5],
  ]);
  const out = rankClusters(cands, ['ai', 'crypto'] as Category[], NONE, penalties, 10);
  // id1: overlap 2 − штраф 3 = −1 ; id2: overlap 1 − штраф 0 = 1 → id2 выше
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]);
  assert.equal(out.find((c) => c.clusterId === 1)?.score, -1);
  assert.equal(out.find((c) => c.clusterId === 2)?.score, 1);
});

test('rankClusters: тай-брейк по is_major при равном скоре', () => {
  const cands = [
    cand({ id: 1, tags: '["ai"]', isMajor: 0 }),
    cand({ id: 2, tags: '["ai"]', isMajor: 1 }),
  ];
  const out = rankClusters(cands, ['ai'] as Category[], NONE, NOPEN, 10);
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]);
});

test('rankClusters: тай-брейк по числу источников (при равном скоре/мажорности)', () => {
  const cands = [
    cand({ id: 1, tags: '["ai"]', sourceCount: 1 }),
    cand({ id: 2, tags: '["ai"]', sourceCount: 3 }),
  ];
  const out = rankClusters(cands, ['ai'] as Category[], NONE, NOPEN, 10);
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]);
});

test('rankClusters: тай-брейк по quality, затем свежести, затем id', () => {
  const base = { tags: '["ai"]', isMajor: 0, sourceCount: 1 };
  let out = rankClusters(
    [cand({ id: 1, ...base, quality: 40 }), cand({ id: 2, ...base, quality: 90 })],
    ['ai'] as Category[], NONE, NOPEN, 10,
  );
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]); // по quality

  out = rankClusters(
    [cand({ id: 1, ...base, quality: 50, updatedAt: 100 }), cand({ id: 2, ...base, quality: 50, updatedAt: 200 })],
    ['ai'] as Category[], NONE, NOPEN, 10,
  );
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]); // по свежести

  out = rankClusters(
    [cand({ id: 5, ...base, quality: 50, updatedAt: 100 }), cand({ id: 3, ...base, quality: 50, updatedAt: 100 })],
    ['ai'] as Category[], NONE, NOPEN, 10,
  );
  assert.deepEqual(out.map((c) => c.clusterId), [3, 5]); // полностью равны → меньший id первым
});

test('rankClusters: quality=null трактуется как 0 в тай-брейке', () => {
  const base = { tags: '["ai"]' };
  const out = rankClusters(
    [cand({ id: 1, ...base, quality: null }), cand({ id: 2, ...base, quality: 10 })],
    ['ai'] as Category[], NONE, NOPEN, 10,
  );
  assert.deepEqual(out.map((c) => c.clusterId), [2, 1]);
});

test('rankClusters: repSource=null не блокируется и не штрафуется', () => {
  const out = rankClusters(
    [cand({ id: 1, tags: '["ai"]', repSource: null })],
    ['ai'] as Category[], new Set(['x']), new Map([['x', -9]]), 10,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 1);
});

test('rankClusters: усечение до topN', () => {
  const cands = [
    cand({ id: 1, tags: '["ai"]' }),
    cand({ id: 2, tags: '["ai"]' }),
    cand({ id: 3, tags: '["ai"]' }),
  ];
  const out = rankClusters(cands, ['ai'] as Category[], NONE, NOPEN, 2);
  assert.equal(out.length, 2);
});

test('rankClusters: пустые интересы → пустой результат', () => {
  const out = rankClusters([cand({ id: 1, tags: '["ai"]' })], [], NONE, NOPEN, 10);
  assert.equal(out.length, 0);
});
