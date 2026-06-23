// Чистое детерминированное ядро кластеризации: время события, выбор кластера для
// присоединения и выбор представителя. Без БД — юнит-тестируемо на фикстурах.

/** Время события статьи: публикация, иначе время фетча. */
export function eventTime(a: { publishedAt: number | null; fetchedAt: number }): number {
  return a.publishedAt ?? a.fetchedAt;
}

/** Кандидат на присоединение (одинаковый непустой cluster_key). */
export interface ClusterCandidate {
  id: number;
  firstSeen: number;
}

/**
 * Кластер для присоединения статьи с временем события evt: из кандидатов, укладывающихся
 * в окно (evt <= firstSeen + windowMs), берём наибольший first_seen (самый свежий кластер),
 * тай-брейк — наибольший id. Нет подходящих → null (нужен новый кластер).
 */
export function pickCluster(
  candidates: ClusterCandidate[],
  evt: number,
  windowMs: number,
): number | null {
  let best: ClusterCandidate | null = null;
  for (const c of candidates) {
    if (evt > c.firstSeen + windowMs) continue; // за окном
    if (
      best === null ||
      c.firstSeen > best.firstSeen ||
      (c.firstSeen === best.firstSeen && c.id > best.id)
    ) {
      best = c;
    }
  }
  return best === null ? null : best.id;
}

/** Поля статьи, нужные для выбора представителя. */
export interface RepCandidate {
  id: number;
  quality: number;
  publishedAt: number | null;
}

/** a лучше b как представитель: max quality → ранний publishedAt (nulls last) → меньший id. */
function isBetterRep(a: RepCandidate, b: RepCandidate): boolean {
  if (a.quality !== b.quality) return a.quality > b.quality;
  if (a.publishedAt !== b.publishedAt) {
    if (a.publishedAt === null) return false; // nulls last
    if (b.publishedAt === null) return true;
    return a.publishedAt < b.publishedAt; // ранний выигрывает
  }
  return a.id < b.id;
}

/** Лучший представитель из непустого списка членов кластера. */
export function pickRepresentative<T extends RepCandidate>(members: readonly T[]): T {
  if (members.length === 0) {
    throw new Error('pickRepresentative: пустой список членов');
  }
  return members.reduce((best, m) => (isBetterRep(m, best) ? m : best));
}
