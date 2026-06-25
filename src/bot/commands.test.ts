import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeleteAction } from './commands.js';

test('parseDeleteAction', () => {
  assert.equal(parseDeleteAction('del~yes'), 'yes');
  assert.equal(parseDeleteAction('del~no'), 'no');
  assert.equal(parseDeleteAction('ob~lang~ru'), undefined);
});
