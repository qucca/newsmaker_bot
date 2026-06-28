import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestDueWindow } from './windows.js';

const PRESETS = ['08:00', '13:00', '19:00', '22:00'];

test('latestDueWindow: возвращает последнюю пройденную сегодня границу', () => {
  const now = Date.UTC(2026, 5, 28, 14, 5); // 14:05 UTC
  assert.equal(latestDueWindow(PRESETS, 'UTC', now), Date.UTC(2026, 5, 28, 13, 0));
});

test('latestDueWindow: ровно на границе считается наступившей (<=)', () => {
  const now = Date.UTC(2026, 5, 28, 8, 0);
  assert.equal(latestDueWindow(PRESETS, 'UTC', now), Date.UTC(2026, 5, 28, 8, 0));
});

test('latestDueWindow: до первого окна сегодня → null (вчерашнее не досылаем)', () => {
  const now = Date.UTC(2026, 5, 28, 7, 30);
  assert.equal(latestDueWindow(PRESETS, 'UTC', now), null);
});

test('latestDueWindow: поздно вечером → последнее окно дня', () => {
  const now = Date.UTC(2026, 5, 28, 23, 30);
  assert.equal(latestDueWindow(PRESETS, 'UTC', now), Date.UTC(2026, 5, 28, 22, 0));
});

test('latestDueWindow: ранним утром следующего дня → null (граница локального дня)', () => {
  const now = Date.UTC(2026, 5, 29, 2, 0); // 02:00 следующего дня
  assert.equal(latestDueWindow(PRESETS, 'UTC', now), null);
});

test('latestDueWindow: учитывает таймзону юзера', () => {
  // Токио UTC+9. now = 00:30 UTC 28-го = 09:30 по Токио 28-го → пройдено 08:00 Токио.
  // 08:00 Токио 28 июня = 23:00 UTC 27 июня.
  const now = Date.UTC(2026, 5, 28, 0, 30);
  assert.equal(latestDueWindow(['08:00'], 'Asia/Tokyo', now), Date.UTC(2026, 5, 27, 23, 0));
});

test('latestDueWindow: невалидные строки окон пропускаются', () => {
  const now = Date.UTC(2026, 5, 28, 14, 0);
  assert.equal(
    latestDueWindow(['08:00', 'bad', '25:99', '13:00'], 'UTC', now),
    Date.UTC(2026, 5, 28, 13, 0),
  );
});

test('latestDueWindow: пустой список окон → null', () => {
  assert.equal(latestDueWindow([], 'UTC', Date.UTC(2026, 5, 28, 14, 0)), null);
});

test('latestDueWindow: невалидная таймзона → null (защитно)', () => {
  assert.equal(latestDueWindow(['08:00'], 'Not/AZone', Date.UTC(2026, 5, 28, 14, 0)), null);
});
