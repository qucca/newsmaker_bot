import type { PromptBlock } from '../llm/index.js';

/** Вход рендера: целевой язык + сущности (канонич. имена) + нейтральные факты кластера. */
export interface RenderInput {
  lang: string;
  entities: string[];
  facts: string[];
}

// Системная инструкция стабильна между прогонами → cache:true (кеш промпта).
const SYSTEM_TEXT = [
  'You write a news card for a multilingual news bot: a title and a short neutral summary.',
  'You receive a JSON object: { lang, entities, facts }.',
  '- lang: target language as an ISO 639-1 code. Write BOTH title and summary in THIS language,',
  '  even when the facts are written in another language.',
  '- entities: canonical entity names — use them for correct names in the target language.',
  '- facts: neutral factual statements about what happened (the ONLY source material).',
  '',
  'Return ONE JSON object with exactly these fields:',
  '- title: a real, informative headline in the target language. Neutral, not clickbait,',
  '  no trailing period, about 100 characters or fewer.',
  '- summary: neutral prose in the target language, 1 to 4 sentences. Let the length follow the',
  '  story — a simple item is shorter, a fact-rich one is longer. Aim for ~2-3 sentences /',
  '  ~600 characters. Cover the key facts without losing the essence, but stay concise.',
  '',
  'Rules:',
  '- Base everything ONLY on the given facts. Do not invent or add outside knowledge.',
  '- Do NOT copy the original article wording — write your own neutral summary.',
  '- No opinion, no source bias, no persuasion. State what happened.',
].join('\n');

/** Строит system (кешируемый) и input блоки для рендера одной пары. */
export function buildRenderPrompt(input: RenderInput): {
  system: PromptBlock[];
  input: PromptBlock[];
} {
  return {
    system: [{ text: SYSTEM_TEXT, cache: true }],
    input: [
      { text: JSON.stringify({ lang: input.lang, entities: input.entities, facts: input.facts }) },
    ],
  };
}
