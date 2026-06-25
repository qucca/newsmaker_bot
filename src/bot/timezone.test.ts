import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TZ_PRESETS, defaultTzForLang, isValidIana } from './timezone.js';

test('пресеты включают Москву и UTC', () => {
  assert.ok(TZ_PRESETS.includes('Europe/Moscow'));
  assert.ok(TZ_PRESETS.includes('UTC'));
});

test('дефолт: ru -> Europe/Moscow, en -> UTC', () => {
  assert.equal(defaultTzForLang('ru'), 'Europe/Moscow');
  assert.equal(defaultTzForLang('en'), 'UTC');
});

test('isValidIana: валидные и мусор', () => {
  assert.equal(isValidIana('Asia/Tokyo'), true);
  assert.equal(isValidIana('Europe/Moscow'), true);
  assert.equal(isValidIana('Mars/Phobos'), false);
  assert.equal(isValidIana(''), false);
});
