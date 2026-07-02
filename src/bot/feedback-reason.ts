import type { Category } from '../categories.js';

// Чистая сборка опций пикера причины из фактов карточки. Правила (спек §4.3):
// тег один (первый matched), страны — кап 2 по значимости, всегда ≤4 кнопки.
// «Просто регион» показываем только при ровно одной стране; при двух — жертвуем ради лимита.

const ISO2 = /^[A-Z]{2}$/;
const MAX_COUNTRIES = 2;

export type ReasonOption =
  | { type: 'pair'; tag: Category; cc: string }
  | { type: 'tag'; tag: Category }
  | { type: 'region'; cc: string }
  | { type: 'source' };

export function buildReasonOptions(
  matchedTag: Category | undefined,
  regions: string[],
): ReasonOption[] {
  const countries = regions.filter((r) => r !== 'GLOBAL' && ISO2.test(r)).slice(0, MAX_COUNTRIES);
  const opts: ReasonOption[] = [];
  if (matchedTag !== undefined) {
    for (const cc of countries) opts.push({ type: 'pair', tag: matchedTag, cc });
    opts.push({ type: 'tag', tag: matchedTag });
  }
  if (countries.length === 1) opts.push({ type: 'region', cc: countries[0]! });
  opts.push({ type: 'source' });
  return opts;
}
