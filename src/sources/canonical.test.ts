import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl } from './canonical.js';

test('форсит https, lowercase хост, срезает www, сохраняет регистр пути', () => {
  assert.equal(canonicalizeUrl('HTTP://WWW.Example.com/Path/To'), 'https://example.com/Path/To');
});

test('убирает #fragment', () => {
  assert.equal(canonicalizeUrl('https://e.com/a#section-2'), 'https://e.com/a');
});

test('убирает дефолтные порты (80 у http, 443 у https)', () => {
  assert.equal(canonicalizeUrl('https://e.com:443/a'), 'https://e.com/a');
  assert.equal(canonicalizeUrl('http://e.com:80/a'), 'https://e.com/a');
});

test('срезает хвостовой слэш, но сохраняет корневой', () => {
  assert.equal(canonicalizeUrl('https://e.com/a/'), 'https://e.com/a');
  assert.equal(canonicalizeUrl('https://e.com/'), 'https://e.com/');
  assert.equal(canonicalizeUrl('https://e.com'), 'https://e.com/');
});

test('удаляет трекинг-параметры, остальные оставляет и сортирует по алфавиту', () => {
  assert.equal(
    canonicalizeUrl('https://e.com/a?b=2&utm_source=x&a=1&fbclid=z'),
    'https://e.com/a?a=1&b=2',
  );
});

test('сохраняет осмысленный id-параметр (не схлопывает разные статьи)', () => {
  assert.equal(
    canonicalizeUrl('https://e.com/news?id=123&utm_medium=rss'),
    'https://e.com/news?id=123',
  );
  assert.notEqual(
    canonicalizeUrl('https://e.com/news?id=123'),
    canonicalizeUrl('https://e.com/news?id=456'),
  );
});

test('query только из трекинга → query исчезает целиком', () => {
  assert.equal(canonicalizeUrl('https://e.com/a?utm_source=x&fbclid=y'), 'https://e.com/a');
});

test('трекинг матчится по префиксам utm_/at_ и регистронезависимо (ICID)', () => {
  assert.equal(
    canonicalizeUrl('https://e.com/a?utm_campaign=x&at_custom=y&ICID=z&keep=1'),
    'https://e.com/a?keep=1',
  );
});

test('непарсимый или не-http(s) URL → null', () => {
  assert.equal(canonicalizeUrl('not a url'), null);
  assert.equal(canonicalizeUrl('/relative/path'), null);
  assert.equal(canonicalizeUrl('mailto:a@b.com'), null);
  assert.equal(canonicalizeUrl('ftp://e.com/a'), null);
});

test('разные представления одной статьи схлопываются в один canonical_url', () => {
  const a = canonicalizeUrl('http://www.bbc.com/news/world-123?utm_source=twitter');
  const b = canonicalizeUrl('https://bbc.com/news/world-123#top');
  assert.equal(a, 'https://bbc.com/news/world-123');
  assert.equal(a, b);
});
