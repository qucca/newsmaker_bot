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
  const cfg = parseConfig({
    TELEGRAM_BOT_TOKEN: 't',
    CLUSTER_WINDOW_HOURS: '48',
    CLUSTER_RUN_CAP: '100',
  });
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

test('SCORE_WINDOW_HOURS: дефолт 72', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.SCORE_WINDOW_HOURS, 72);
});

test('SCORE_WINDOW_HOURS: коэрсится из строки и должен быть положительным', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't', SCORE_WINDOW_HOURS: '48' });
  assert.equal(c.SCORE_WINDOW_HOURS, 48);
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', SCORE_WINDOW_HOURS: '0' }));
});

test('SEND_GLOBAL_RPS / SEND_PER_CHAT_RPS: дефолты 30 / 1', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.SEND_GLOBAL_RPS, 30);
  assert.equal(c.SEND_PER_CHAT_RPS, 1);
});

test('SEND_*_RPS: коэрсятся из строки и должны быть положительными', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't', SEND_GLOBAL_RPS: '25', SEND_PER_CHAT_RPS: '2' });
  assert.equal(c.SEND_GLOBAL_RPS, 25);
  assert.equal(c.SEND_PER_CHAT_RPS, 2);
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', SEND_GLOBAL_RPS: '0' }));
});

test('Планировщик (T15): дефолты интервалов тикера', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.TICK_INTERVAL_MIN, 15);
  assert.equal(c.GLOBAL_PASS_INTERVAL_MIN, 30);
});

test('Планировщик (T15): интервалы коэрсятся из строки и должны быть положительными', () => {
  const c = parseConfig({
    TELEGRAM_BOT_TOKEN: 't',
    TICK_INTERVAL_MIN: '30',
    GLOBAL_PASS_INTERVAL_MIN: '60',
  });
  assert.equal(c.TICK_INTERVAL_MIN, 30);
  assert.equal(c.GLOBAL_PASS_INTERVAL_MIN, 60);
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', TICK_INTERVAL_MIN: '0' }));
});

test('CALIBRATION_CARDS: дефолт 30, коэрсится, неотрицательный', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.CALIBRATION_CARDS, 30);
  assert.equal(
    parseConfig({ TELEGRAM_BOT_TOKEN: 't', CALIBRATION_CARDS: '0' }).CALIBRATION_CARDS,
    0,
  );
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', CALIBRATION_CARDS: '-1' }));
});

test('GOOGLE_NEWS_ENABLED: дефолт false, парсит true/false (kill-switch GN, T16)', () => {
  assert.equal(parseConfig({ TELEGRAM_BOT_TOKEN: 't' }).GOOGLE_NEWS_ENABLED, false);
  assert.equal(
    parseConfig({ TELEGRAM_BOT_TOKEN: 't', GOOGLE_NEWS_ENABLED: 'true' }).GOOGLE_NEWS_ENABLED,
    true,
  );
  assert.equal(
    parseConfig({ TELEGRAM_BOT_TOKEN: 't', GOOGLE_NEWS_ENABLED: 'false' }).GOOGLE_NEWS_ENABLED,
    false,
  );
});

test('RENDER_MAX_OUTPUT_TOKENS: дефолт 800, коэрсится, положительный', () => {
  const c = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(c.RENDER_MAX_OUTPUT_TOKENS, 800);
  assert.equal(
    parseConfig({ TELEGRAM_BOT_TOKEN: 't', RENDER_MAX_OUTPUT_TOKENS: '1200' })
      .RENDER_MAX_OUTPUT_TOKENS,
    1200,
  );
  assert.throws(() => parseConfig({ TELEGRAM_BOT_TOKEN: 't', RENDER_MAX_OUTPUT_TOKENS: '0' }));
});
