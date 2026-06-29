import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, WINDOW_PRESETS, VOLUME_PRESETS } from './reducer.js';

test('initialState: шаг lang, uiLang проброшен', () => {
  const s = initialState('en');
  assert.equal(s.step, 'lang');
  assert.equal(s.uiLang, 'en');
  assert.deepEqual(s.draft.interestTags, []);
});

test('pickLang: ставит lang+uiLang, переход в interests, рендер interests', () => {
  const { next, effects } = reduce(initialState('en'), { t: 'pickLang', lang: 'ru' });
  assert.equal(next.step, 'interests');
  assert.equal(next.draft.lang, 'ru');
  assert.equal(next.uiLang, 'ru');
  assert.deepEqual(effects, [{ kind: 'render', screen: { name: 'interests' } }]);
});

test('toggleTag: добавляет и снимает тег, остаёмся на interests', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'football' }).next;
  assert.deepEqual(s.draft.interestTags, ['football']);
  s = reduce(s, { t: 'toggleTag', tag: 'football' }).next;
  assert.deepEqual(s.draft.interestTags, []);
});

test('selectGroup: добавляет выбираемые листья группы (без catch-all) один раз', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'selectGroup', group: 'sports' }).next;
  assert.ok(s.draft.interestTags.includes('football'));
  assert.ok(s.draft.interestTags.includes('tennis'));
  assert.ok(!s.draft.interestTags.includes('sports_other'), 'catch-all не выбирается (P2a)');
  const before = s.draft.interestTags.length;
  s = reduce(s, { t: 'selectGroup', group: 'sports' }).next; // повтор не дублирует
  assert.equal(s.draft.interestTags.length, before);
});

test('pageNext/pagePrev: листание групп в границах', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  assert.equal(s.groupPage, 0);
  s = reduce(s, { t: 'pagePrev' }).next; // не уходит ниже 0
  assert.equal(s.groupPage, 0);
  s = reduce(s, { t: 'pageNext' }).next;
  assert.equal(s.groupPage, 1);
});

test('tagsDone без тегов: alert, остаёмся; с тегами: переход в profile', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  let r = reduce(s, { t: 'tagsDone' });
  assert.equal(r.next.step, 'interests');
  assert.deepEqual(r.effects, [{ kind: 'alert', key: 'onb_need_one_tag' }]);
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  r = reduce(s, { t: 'tagsDone' });
  assert.equal(r.next.step, 'profile');
  assert.deepEqual(r.effects, [{ kind: 'render', screen: { name: 'profile' } }]);
});

test('profileText усекается до PROFILE_MAX_LEN, переход в tz', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  s = reduce(s, { t: 'tagsDone' }).next;
  const r = reduce(s, { t: 'profileText', text: 'x'.repeat(5000) });
  assert.equal(r.next.draft.profileText.length, 1000);
  assert.equal(r.next.step, 'tz');
});

test('profileSkip: пустой profileText, переход в tz', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  s = reduce(s, { t: 'tagsDone' }).next;
  const r = reduce(s, { t: 'profileSkip' });
  assert.equal(r.next.draft.profileText, '');
  assert.equal(r.next.step, 'tz');
});

test('tzOther -> ждём ввод; tzInput valid -> windows; invalid -> alert+ask', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  s = reduce(s, { t: 'tagsDone' }).next;
  s = reduce(s, { t: 'profileSkip' }).next;
  let r = reduce(s, { t: 'tzOther' });
  assert.equal(r.next.awaitingTzInput, true);
  assert.deepEqual(r.effects, [{ kind: 'render', screen: { name: 'tzAskInput' } }]);
  r = reduce(r.next, { t: 'tzInput', tz: 'Mars/Phobos', valid: false });
  assert.deepEqual(r.effects, [{ kind: 'alert', key: 'onb_tz_bad_input' }, { kind: 'render', screen: { name: 'tzAskInput' } }]);
  r = reduce(r.next, { t: 'tzInput', tz: 'Asia/Tokyo', valid: true });
  assert.equal(r.next.draft.tz, 'Asia/Tokyo');
  assert.equal(r.next.step, 'windows');
});

test('pickTz: ставит tz, переход в windows', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  s = reduce(s, { t: 'tagsDone' }).next;
  s = reduce(s, { t: 'profileSkip' }).next;
  const r = reduce(s, { t: 'pickTz', tz: 'Europe/Moscow' });
  assert.equal(r.next.draft.tz, 'Europe/Moscow');
  assert.equal(r.next.step, 'windows');
});

test('windows: toggle, валидация >=1, сортировка; затем volume; pickVolume -> done+commit', () => {
  let s = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  s = reduce(s, { t: 'toggleTag', tag: 'ai' }).next;
  s = reduce(s, { t: 'tagsDone' }).next;
  s = reduce(s, { t: 'profileSkip' }).next;
  s = reduce(s, { t: 'pickTz', tz: 'UTC' }).next;
  // пусто -> alert
  let r = reduce(s, { t: 'windowsDone' });
  assert.deepEqual(r.effects, [{ kind: 'alert', key: 'onb_need_one_window' }]);
  s = reduce(s, { t: 'toggleWindow', window: '19:00' }).next;
  s = reduce(s, { t: 'toggleWindow', window: '08:00' }).next;
  r = reduce(s, { t: 'windowsDone' });
  assert.deepEqual(r.next.draft.readingWindows, ['08:00', '19:00']); // отсортировано
  assert.equal(r.next.step, 'volume');
  r = reduce(r.next, { t: 'pickVolume', n: 5 });
  assert.equal(r.next.draft.maxItemsPerSend, 5);
  assert.equal(r.next.step, 'done');
  assert.deepEqual(r.effects, [
    { kind: 'commit' },
    { kind: 'render', screen: { name: 'summary' } },
  ]);
});

test('константы пресетов', () => {
  assert.deepEqual([...WINDOW_PRESETS], ['08:00', '13:00', '19:00', '22:00']);
  assert.deepEqual([...VOLUME_PRESETS], [3, 5, 10]);
});
