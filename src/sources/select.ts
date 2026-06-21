// Отсев по свежести и кап числа кандидатов — детерминированные шаги сбора (T4).
// Решения по поведению: режем старше окна кластеризации (~72ч), записи без даты
// оставляем; кап берёт самые свежие, недатированные считаем самыми старыми.

/** Запись старше окна (now - publishedAt > maxAgeMs) выкидываем. null-дата — оставляем. */
export function isFresh(publishedAt: number | null, now: number, maxAgeMs: number): boolean {
  if (publishedAt === null) return true;
  return now - publishedAt <= maxAgeMs;
}

/**
 * Оставляет не более `cap` записей, предпочитая самые свежие (publishedAt desc).
 * Недатированные (null) считаются самыми старыми и выпадают первыми при превышении.
 */
export function applyCap<T extends { publishedAt: number | null }>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const sorted = [...items].sort(
    (a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity),
  );
  return sorted.slice(0, cap);
}
