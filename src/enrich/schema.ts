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
 * Схема ответа на чанк: массив EnrichItem, у которого набор ref в точности совпадает
 * со входом (по количеству и значениям, без дублей). Рассинхрон → провал схемы → ретрай
 * клиента; повторный провал ловит оркестратор и пропускает чанк.
 */
export function makeBatchSchema(refs: number[]): z.ZodType<EnrichItem[]> {
  const expected = new Set(refs);
  return z.array(EnrichItemSchema).superRefine((items, ctx) => {
    if (items.length !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected ${refs.length} items, got ${items.length}`,
      });
    }
    const seen = new Set<number>();
    for (const it of items) {
      if (!expected.has(it.ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unexpected ref ${it.ref}` });
      }
      if (seen.has(it.ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ref ${it.ref}` });
      }
      seen.add(it.ref);
    }
  });
}
