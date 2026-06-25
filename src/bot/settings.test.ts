import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettingsTarget, fieldToStep, fieldToScreen } from './settings.js';

test('parseSettingsTarget', () => {
  assert.equal(parseSettingsTarget('set~tz'), 'tz');
  assert.equal(parseSettingsTarget('set~open'), 'open');
  assert.equal(parseSettingsTarget('set~interests'), 'interests');
  assert.equal(parseSettingsTarget('ob~lang~ru'), undefined);
  assert.equal(parseSettingsTarget('set~bogus'), undefined);
});

test('fieldToStep', () => {
  assert.equal(fieldToStep('lang'), 'lang');
  assert.equal(fieldToStep('interests'), 'interests');
  assert.equal(fieldToStep('profile'), 'profile');
  assert.equal(fieldToStep('tz'), 'tz');
  assert.equal(fieldToStep('windows'), 'windows');
  assert.equal(fieldToStep('volume'), 'volume');
});

test('fieldToScreen', () => {
  assert.deepEqual(fieldToScreen('lang'), { name: 'lang' });
  assert.deepEqual(fieldToScreen('interests'), { name: 'interests' });
  assert.deepEqual(fieldToScreen('profile'), { name: 'profile' });
  assert.deepEqual(fieldToScreen('tz'), { name: 'tz' });
  assert.deepEqual(fieldToScreen('windows'), { name: 'windows' });
  assert.deepEqual(fieldToScreen('volume'), { name: 'volume' });
});
