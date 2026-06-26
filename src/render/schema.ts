import { z } from 'zod';

/**
 * Ответ рендера одной пары (cluster, lang). Один объект на вызов (НЕ батч).
 * Потолки — предохранитель от runaway, не «правильная длина»: длину держит промпт
 * (title ≤ ~100, summary 1–4 предложения / ~600). content_hash и model пишет оркестратор.
 */
export const RenderSummarySchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
});

export type RenderSummary = z.infer<typeof RenderSummarySchema>;
