import { z } from 'zod';
import { CATEGORIES } from '../categories.js';

/** Один обогащённый кандидат (выход LLM). ref = индекс статьи во входном батче. */
export const EnrichItemSchema = z.object({
  ref: z.number().int().nonnegative(),
  entities: z.array(z.string().min(1)).min(1).max(6), // канонические, по убыванию значимости
  tags: z.array(z.enum(CATEGORIES)).max(4), // только из словаря; 0..4
  quality: z.number().int().min(0).max(100), // содержательность
  is_urgent: z.boolean(),
  is_major: z.boolean(),
  neutral_facts: z.array(z.string().min(1)).min(2).max(6), // на языке оригинала
});

export type EnrichItem = z.infer<typeof EnrichItemSchema>;

/**
 * Схема-ПОДСКАЗКА для output_config.format: массив EnrichItem. Ведёт модель по форме каждого
 * объекта (поля, enum-теги), НО не гарантирует межобъектных инвариантов (ровно N, те же ref) —
 * это невыразимо в JSON Schema. Валидацию количества/ref делаем сами, per-item (matchEnrichItems).
 */
export const ENRICH_BATCH_FORMAT: z.ZodType<EnrichItem[]> = z.array(EnrichItemSchema);

/**
 * Per-item отбор ответа LLM: из сырого массива берём только объекты, которые
 *  (1) проходят EnrichItemSchema,
 *  (2) имеют ожидаемый ref (∈ refs),
 *  (3) не дублируют уже взятый ref (первый выигрывает).
 * Всё остальное — лишнее/битое/дубли — молча отбрасывается. Живая модель шумит (лишний
 * объект, тег вне словаря, не тот ref); «всё или ничего» ронял весь батч, здесь — только мусор.
 * Несматченные статьи чанка остаются необогащёнными и дообработаются в следующем прогоне.
 */
export function matchEnrichItems(raw: unknown, refs: number[]): EnrichItem[] {
  if (!Array.isArray(raw)) return [];
  const expected = new Set(refs);
  const seen = new Set<number>();
  const out: EnrichItem[] = [];
  for (const candidate of raw) {
    const parsed = EnrichItemSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!expected.has(item.ref) || seen.has(item.ref)) continue;
    seen.add(item.ref);
    out.push(item);
  }
  return out;
}
