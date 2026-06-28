import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGnewsFeedUrl, gnewsFeedName, GNEWS_TOPICS } from './gnews-url.js';

test('TOP → фид топ-стори без секции', () => {
  assert.equal(
    buildGnewsFeedUrl({ hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'TOP' }),
    'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  );
});

test('секционный топик → путь /rss/headlines/section/topic/<TOPIC>', () => {
  assert.equal(
    buildGnewsFeedUrl({ hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'WORLD' }),
    'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
  );
});

test('двоеточие в ceid не percent-энкодится (GN ждёт литеральное US:en)', () => {
  const url = buildGnewsFeedUrl({ hl: 'ru', gl: 'RU', ceid: 'RU:ru', topic: 'BUSINESS' });
  assert.ok(url.includes('ceid=RU:ru'), `ожидался литеральный ceid, получено: ${url}`);
});

test('порядок параметров фиксирован (hl, gl, ceid) — детерминированный URL', () => {
  const a = buildGnewsFeedUrl({ hl: 'de', gl: 'DE', ceid: 'DE:de', topic: 'TOP' });
  const b = buildGnewsFeedUrl({ topic: 'TOP', ceid: 'DE:de', gl: 'DE', hl: 'de' });
  assert.equal(a, b);
});

test('имя фида деривируется: TOP → Top stories, секция → Title Case, с hl', () => {
  assert.equal(gnewsFeedName({ topic: 'TOP', hl: 'en-US' }), 'Google News: Top stories (en-US)');
  assert.equal(gnewsFeedName({ topic: 'WORLD', hl: 'en-US' }), 'Google News: World (en-US)');
  assert.equal(gnewsFeedName({ topic: 'TECHNOLOGY', hl: 'ru' }), 'Google News: Technology (ru)');
});

test('GNEWS_TOPICS включает TOP и восемь секций', () => {
  assert.deepEqual(
    [...GNEWS_TOPICS],
    ['TOP', 'WORLD', 'NATION', 'BUSINESS', 'TECHNOLOGY', 'ENTERTAINMENT', 'SPORTS', 'SCIENCE', 'HEALTH'],
  );
});
