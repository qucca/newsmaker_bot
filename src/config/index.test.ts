import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from './index.js';

test('parseConfig: дефолты обогащения', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(cfg.MAX_ENRICH_BATCH, 20);
  assert.equal(cfg.ENRICH_RUN_CAP, 200);
});

test('parseConfig: переопределение обогащения из env (coerce)', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't', MAX_ENRICH_BATCH: '5', ENRICH_RUN_CAP: '50' });
  assert.equal(cfg.MAX_ENRICH_BATCH, 5);
  assert.equal(cfg.ENRICH_RUN_CAP, 50);
});
