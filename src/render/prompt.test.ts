import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderPrompt } from './prompt.js';

test('buildRenderPrompt: system кешируемый, input несёт lang/entities/facts', () => {
  const { system, input } = buildRenderPrompt({ lang: 'ru', entities: ['NATO'], facts: ['Fact one.'] });
  assert.equal(system[0].cache, true);
  const payload = JSON.parse(input[0].text) as { lang: string; entities: string[]; facts: string[] };
  assert.deepEqual(payload, { lang: 'ru', entities: ['NATO'], facts: ['Fact one.'] });
});
