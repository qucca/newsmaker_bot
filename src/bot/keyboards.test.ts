import { test } from 'node:test';
import assert from 'node:assert/strict';
import { langKb, interestsKb, volumeKb, tzKb } from './keyboards.js';

function allCb(kb: { inline_keyboard: { callback_data?: string }[][] }): string[] {
  return kb.inline_keyboard.flat().map((b) => b.callback_data ?? '');
}

test('langKb: ru и en кнопки', () => {
  const cb = allCb(langKb());
  assert.ok(cb.includes('ob~lang~ru'));
  assert.ok(cb.includes('ob~lang~en'));
});

test('interestsKb: тоггл-кнопка несёт ✓ для выбранного и навигацию', () => {
  const kb = interestsKb('ru', 5, new Set(['football'])); // 5 — группа sports
  const cb = allCb(kb);
  assert.ok(cb.includes('ob~tag~football'));
  assert.ok(cb.includes('ob~tags~done'));
  assert.ok(cb.some((c) => c === 'ob~pg~prev' || c === 'ob~pg~next'));
});

test('volumeKb: 3/5/10', () => {
  const cb = allCb(volumeKb());
  assert.deepEqual(cb, ['ob~vol~3', 'ob~vol~5', 'ob~vol~10']);
});

test('tzKb: содержит пресет и кнопку Другой', () => {
  const cb = allCb(tzKb('ru'));
  assert.ok(cb.includes('ob~tz~Europe/Moscow'));
  assert.ok(cb.includes('ob~tz~other'));
});
