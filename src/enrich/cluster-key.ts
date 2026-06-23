// Детерминированный вывод язык-независимого ключа кластера из топ-сущностей.
// Используется T7 (заполнить articles.cluster_key) и переиспользуется T8 (матчинг в окне).
// Правило (docs/design.md): нормализованный набор топ-сущностей, lowercase, отсортировать, склеить.

const TOP_K = 5;

/** Нормализация одной сущности: lowercase, снять диакритику, убрать пунктуацию, схлопнуть пробелы. */
function normalize(entity: string): string {
  return entity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '') // combining diacritical marks
    .replace(/[^a-z0-9\s]/g, '') // оставляем буквы/цифры/пробелы
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ключ кластера из сущностей (по убыванию значимости на входе): нормализуем, отбрасываем
 * пустые, дедупим с сохранением порядка, берём топ-K, сортируем и склеиваем через '|'.
 * Пустой вход (или всё отнормализовалось в пусто) → пустой ключ (такая статья не матчится).
 */
export function deriveClusterKey(entities: string[]): string {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const e of entities) {
    const n = normalize(e);
    if (n.length === 0 || seen.has(n)) continue;
    seen.add(n);
    normalized.push(n);
  }
  return normalized.slice(0, TOP_K).sort().join('|');
}
