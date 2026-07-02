import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedbackCallback } from './feedback.js';
import { categoryIndex } from '../categories.js';

test('parseFeedbackCallback: up/down/back', () => {
  assert.deepEqual(parseFeedbackCallback('fb~up~42'), { kind: 'up', clusterId: 42 });
  assert.deepEqual(parseFeedbackCallback('fb~down~42'), { kind: 'down', clusterId: 42 });
  assert.deepEqual(parseFeedbackCallback('fb~bk~42'), { kind: 'back', clusterId: 42 });
});

test('parseFeedbackCallback: reason pair/tag/region/source', () => {
  const footballIdx = String(categoryIndex('football'));
  assert.deepEqual(parseFeedbackCallback(`fb~rp~7~${footballIdx}~RU`), { kind: 'reason', clusterId: 7, reasonType: 'pair', reasonKey: 'football|RU' });
  assert.deepEqual(parseFeedbackCallback(`fb~rt~7~${footballIdx}`), { kind: 'reason', clusterId: 7, reasonType: 'tag', reasonKey: 'football' });
  assert.deepEqual(parseFeedbackCallback('fb~rr~7~RU'), { kind: 'reason', clusterId: 7, reasonType: 'region', reasonKey: 'RU' });
  assert.deepEqual(parseFeedbackCallback('fb~rs~7'), { kind: 'reason', clusterId: 7, reasonType: 'source', reasonKey: '' });
});

test('parseFeedbackCallback: мусор → undefined', () => {
  assert.equal(parseFeedbackCallback('fb~rr~7~xx'), undefined); // не ISO-2
  assert.equal(parseFeedbackCallback('fb~rt~7~99999'), undefined); // индекс вне словаря
  assert.equal(parseFeedbackCallback('xx~up~1'), undefined);
});
