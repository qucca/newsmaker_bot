import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, toCandidate, publisherFromUrl, parsePublishedAt } from './parse.js';
import type { SourceRow } from './types.js';

const SOURCE: Pick<SourceRow, 'id' | 'name' | 'lang'> = { id: 7, name: 'Example News', lang: 'en' };

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <item>
    <title>First headline</title>
    <link>https://www.example.com/a?utm=x</link>
    <pubDate>Wed, 21 Oct 2015 07:28:00 GMT</pubDate>
  </item>
  <item>
    <title>Second headline</title>
    <link>https://example.com/b</link>
    <pubDate>Thu, 22 Oct 2015 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

test('parseFeed: разбирает RSS в список items с title/link/датой', async () => {
  const items = await parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, 'First headline');
  assert.equal(items[0]?.link, 'https://www.example.com/a?utm=x');
});

test('publisherFromUrl: хост ссылки без www', () => {
  assert.equal(publisherFromUrl('https://www.example.com/a?x=1', 'fallback'), 'example.com');
});

test('publisherFromUrl: fallback при нерабочем URL', () => {
  assert.equal(publisherFromUrl('/relative/path', 'Example News'), 'Example News');
});

test('parsePublishedAt: ISO-дата → epoch ms', () => {
  assert.equal(parsePublishedAt({ isoDate: '2015-10-21T07:28:00.000Z' }), 1445412480000);
});

test('parsePublishedAt: fallback на pubDate', () => {
  assert.equal(parsePublishedAt({ pubDate: 'Wed, 21 Oct 2015 07:28:00 GMT' }), 1445412480000);
});

test('parsePublishedAt: null при отсутствии и при кривой дате', () => {
  assert.equal(parsePublishedAt({}), null);
  assert.equal(parsePublishedAt({ pubDate: 'not a date' }), null);
});

test('toCandidate: маппит item + source в RawCandidate', () => {
  const c = toCandidate(
    {
      title: 'First headline',
      link: 'https://www.example.com/a',
      isoDate: '2015-10-21T07:28:00.000Z',
    },
    SOURCE,
  );
  assert.deepEqual(c, {
    feedSourceId: 7,
    source: 'example.com',
    lang: 'en',
    title: 'First headline',
    link: 'https://www.example.com/a',
    publishedAt: 1445412480000,
  });
});

test('toCandidate: null без title', () => {
  assert.equal(toCandidate({ link: 'https://example.com/a' }, SOURCE), null);
});

test('toCandidate: null без link', () => {
  assert.equal(toCandidate({ title: 'No link' }, SOURCE), null);
});
