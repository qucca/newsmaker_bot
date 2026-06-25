import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce } from './reducer.js';
import { parseOnbEvent, parseOnbText } from './handler.js';

test('parseOnbEvent: lang/tag/tags-done', () => {
  const s0 = initialState('ru');
  assert.deepEqual(parseOnbEvent(s0, 'ob~lang~ru'), { t: 'pickLang', lang: 'ru' });
  const sInt = reduce(s0, { t: 'pickLang', lang: 'ru' }).next;
  assert.deepEqual(parseOnbEvent(sInt, 'ob~tag~football'), { t: 'toggleTag', tag: 'football' });
  assert.deepEqual(parseOnbEvent(sInt, 'ob~tags~done'), { t: 'tagsDone' });
  assert.deepEqual(parseOnbEvent(sInt, 'ob~grp~sports'), { t: 'selectGroup', group: 'sports' });
});

test('parseOnbEvent: неизвестный тег игнорируется (undefined)', () => {
  const sInt = reduce(initialState('ru'), { t: 'pickLang', lang: 'ru' }).next;
  assert.equal(parseOnbEvent(sInt, 'ob~tag~not_a_tag'), undefined);
});

test('parseOnbEvent: tz preset / other', () => {
  const s = { ...initialState('ru'), step: 'tz' as const };
  assert.deepEqual(parseOnbEvent(s, 'ob~tz~Europe/Moscow'), { t: 'pickTz', tz: 'Europe/Moscow' });
  assert.deepEqual(parseOnbEvent(s, 'ob~tz~other'), { t: 'tzOther' });
});

test('parseOnbText: profile во время profile-шага', () => {
  const s = { ...initialState('ru'), step: 'profile' as const };
  assert.deepEqual(parseOnbText(s, 'мой текст'), { t: 'profileText', text: 'мой текст' });
});

test('parseOnbText: tz во время awaitingTzInput — valid вычисляется через luxon', () => {
  const s = { ...initialState('ru'), step: 'tz' as const, awaitingTzInput: true };
  assert.deepEqual(parseOnbText(s, 'Asia/Tokyo'), { t: 'tzInput', tz: 'Asia/Tokyo', valid: true });
  assert.deepEqual(parseOnbText(s, 'Mars/Phobos'), { t: 'tzInput', tz: 'Mars/Phobos', valid: false });
});

test('parseOnbText: вне profile/awaitingTz — undefined', () => {
  const s = { ...initialState('ru'), step: 'windows' as const };
  assert.equal(parseOnbText(s, 'что-то'), undefined);
});
