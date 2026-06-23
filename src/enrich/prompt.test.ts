import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnrichPrompt, type EnrichInput } from './prompt.js';
import { CATEGORIES } from '../categories.js';

const batch: EnrichInput[] = [
  { ref: 0, source: 'e.com', lang: 'en', title: 'Title A', description: 'desc A' },
  { ref: 1, source: 'r.ru', lang: null, title: 'Заголовок Б', description: null },
];

test('buildEnrichPrompt: системный блок кешируемый и перечисляет все категории', () => {
  const { system } = buildEnrichPrompt(batch);
  assert.equal(system.length, 1);
  assert.equal(system[0].cache, true);
  for (const cat of CATEGORIES) assert.ok(system[0].text.includes(cat));
});

test('buildEnrichPrompt: input — это JSON батча с теми же ref', () => {
  const { input } = buildEnrichPrompt(batch);
  assert.equal(input.length, 1);
  const parsed = JSON.parse(input[0].text) as EnrichInput[];
  assert.deepEqual(
    parsed.map((p) => p.ref),
    [0, 1],
  );
  assert.equal(parsed[1].lang, null);
});
