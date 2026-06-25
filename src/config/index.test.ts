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

test('parseConfig: кластеризация — дефолты окна и капа', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(cfg.CLUSTER_WINDOW_HOURS, 72);
  assert.equal(cfg.CLUSTER_RUN_CAP, 500);
});

test('parseConfig: кластеризация — значения из env коэрсятся', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't', CLUSTER_WINDOW_HOURS: '48', CLUSTER_RUN_CAP: '100' });
  assert.equal(cfg.CLUSTER_WINDOW_HOURS, 48);
  assert.equal(cfg.CLUSTER_RUN_CAP, 100);
});

test('MAX_USERS: дефолт 100', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.MAX_USERS, 100);
});

test('MAX_USERS: коэрсится из строки и должен быть положительным', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't', MAX_USERS: '5' });
  assert.equal(c.MAX_USERS, 5);
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', MAX_USERS: '0' }));
});
