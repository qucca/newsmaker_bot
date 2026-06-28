import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedbackAction } from './feedback.js';

test('parseFeedbackAction: up/down → vote + clusterId', () => {
  assert.deepEqual(parseFeedbackAction('fb~up~42'), { vote: 1, clusterId: 42 });
  assert.deepEqual(parseFeedbackAction('fb~down~7'), { vote: -1, clusterId: 7 });
});

test('parseFeedbackAction: чужой/битый callback → undefined', () => {
  assert.equal(parseFeedbackAction('ob~lang~ru'), undefined); // не наш префикс
  assert.equal(parseFeedbackAction('fb~bad~1'), undefined); // неизвестное направление
  assert.equal(parseFeedbackAction('fb~up~abc'), undefined); // не число
  assert.equal(parseFeedbackAction('fb~up'), undefined); // нет id
  assert.equal(parseFeedbackAction('fb~up~1.5'), undefined); // не целое
});
