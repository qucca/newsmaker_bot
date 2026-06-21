import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConditionalHeaders, extractConditionalGet } from './conditional-get.js';

test('buildConditionalHeaders: пусто без etag и last-modified', () => {
  assert.deepEqual(buildConditionalHeaders({ etag: null, lastModified: null }), {});
});

test('buildConditionalHeaders: If-None-Match при наличии etag', () => {
  assert.deepEqual(buildConditionalHeaders({ etag: 'W/"abc"', lastModified: null }), {
    'If-None-Match': 'W/"abc"',
  });
});

test('buildConditionalHeaders: If-Modified-Since при наличии last-modified', () => {
  const lm = 'Wed, 21 Oct 2015 07:28:00 GMT';
  assert.deepEqual(buildConditionalHeaders({ etag: null, lastModified: lm }), {
    'If-Modified-Since': lm,
  });
});

test('buildConditionalHeaders: оба заголовка при наличии обоих значений', () => {
  const lm = 'Wed, 21 Oct 2015 07:28:00 GMT';
  assert.deepEqual(buildConditionalHeaders({ etag: 'W/"abc"', lastModified: lm }), {
    'If-None-Match': 'W/"abc"',
    'If-Modified-Since': lm,
  });
});

test('extractConditionalGet: читает etag и last-modified из ответа', () => {
  const lm = 'Wed, 21 Oct 2015 07:28:00 GMT';
  const headers = new Headers({ etag: 'W/"xyz"', 'last-modified': lm });
  assert.deepEqual(extractConditionalGet(headers), { etag: 'W/"xyz"', lastModified: lm });
});

test('extractConditionalGet: null когда заголовков нет', () => {
  assert.deepEqual(extractConditionalGet(new Headers()), { etag: null, lastModified: null });
});
