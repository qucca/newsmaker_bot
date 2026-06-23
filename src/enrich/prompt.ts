import type { PromptBlock } from '../llm/index.js';
import { CATEGORIES } from '../categories.js';

/** Вход одной статьи в батч обогащения. ref — индекс статьи в чанке. */
export interface EnrichInput {
  ref: number;
  source: string;
  lang: string | null;
  title: string;
  description: string | null;
}

// Системная инструкция стабильна между прогонами → помечаем cache:true (кеш промпта).
const SYSTEM_TEXT = [
  'You enrich news article candidates for a multilingual news bot.',
  'You receive a JSON array of articles. For EACH article return ONE JSON object.',
  'Return a JSON array with EXACTLY one object per input article and the SAME `ref` values.',
  '',
  'Per-article fields:',
  '- ref: integer — echo the input `ref` unchanged.',
  '- entities: 1..6 canonical entity names, most salient first. Use the common ENGLISH name',
  '  where one exists (people, orgs, places), so the same story in different languages maps together.',
  '- tags: 0..4 topic tags chosen ONLY from this fixed list (omit anything that does not fit):',
  `  ${CATEGORIES.join(', ')}.`,
  '- quality: integer 0..100 — substantiveness of the item: a real, informative news story scores high;',
  '  clickbait, ads/sponsored, listicles, pure opinion score low.',
  '- is_urgent: boolean — breaking / time-sensitive news.',
  '- is_major: boolean — large-scale world event.',
  '- neutral_facts: 2..6 short, neutral factual statements about WHAT HAPPENED,',
  '  written IN THE ORIGINAL LANGUAGE of the article (the `lang` field; if lang is null,',
  '  infer the language from title/description). No opinion, no source bias, no summary framing.',
].join('\n');

/** Строит system (кешируемый) и input блоки для одного чанка обогащения. */
export function buildEnrichPrompt(batch: EnrichInput[]): {
  system: PromptBlock[];
  input: PromptBlock[];
} {
  return {
    system: [{ text: SYSTEM_TEXT, cache: true }],
    input: [{ text: JSON.stringify(batch) }],
  };
}
