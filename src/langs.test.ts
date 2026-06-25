import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, uiLangFromCode, isLang } from './langs.js';

test('LANGS = ru, en', () => {
  assert.deepEqual([...LANGS], ['ru', 'en']);
});

test('uiLangFromCode: ru-* -> ru, прочее -> en, пусто -> en', () => {
  assert.equal(uiLangFromCode('ru'), 'ru');
  assert.equal(uiLangFromCode('ru-RU'), 'ru');
  assert.equal(uiLangFromCode('en-US'), 'en');
  assert.equal(uiLangFromCode('de'), 'en');
  assert.equal(uiLangFromCode(undefined), 'en');
});

test('isLang — type guard', () => {
  assert.equal(isLang('ru'), true);
  assert.equal(isLang('xx'), false);
});
