import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLogLine } from './index.js';

test('formatLogLine: JSON с ts/level/scope/msg и слитыми полями', () => {
  const line = formatLogLine({
    level: 'info',
    scope: 'sources',
    msg: 'feed fetched',
    ts: 1445412480000,
    fields: { sourceId: 7, kept: 3 },
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.scope, 'sources');
  assert.equal(parsed.msg, 'feed fetched');
  assert.equal(parsed.sourceId, 7);
  assert.equal(parsed.kept, 3);
  assert.equal(parsed.ts, '2015-10-21T07:28:00.000Z');
});

test('formatLogLine: без полей не падает', () => {
  const parsed = JSON.parse(formatLogLine({ level: 'warn', scope: 'sources', msg: 'x', ts: 0 }));
  assert.equal(parsed.msg, 'x');
  assert.equal(parsed.level, 'warn');
});
