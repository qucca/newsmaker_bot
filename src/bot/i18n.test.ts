import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS } from '../langs.js';
import { CATEGORIES, CATEGORY_GROUPS } from '../categories.js';
import { t, categoryLabel, groupLabel, MSG_KEYS } from './i18n.js';

test('t: возвращает строку и подставляет параметры', () => {
  assert.equal(typeof t('ru', 'onb_greeting'), 'string');
  const s = t('ru', 'cap_reached');
  assert.ok(s.length > 0);
});

test('полнота: каждый ключ есть в ru и en и непустой', () => {
  for (const key of MSG_KEYS) {
    for (const lang of LANGS) {
      const v = t(lang, key);
      assert.ok(typeof v === 'string' && v.length > 0, `пусто: ${lang}/${key}`);
    }
  }
});

test('полнота: каждый лист категории имеет подпись ru/en', () => {
  for (const cat of CATEGORIES) {
    for (const lang of LANGS) {
      assert.ok(categoryLabel(lang, cat).length > 0, `нет подписи ${lang}/${cat}`);
    }
  }
});

test('полнота: каждая группа имеет подпись ru/en', () => {
  for (const g of CATEGORY_GROUPS) {
    for (const lang of LANGS) {
      assert.ok(groupLabel(lang, g.group).length > 0, `нет подписи ${lang}/${g.group}`);
    }
  }
});
