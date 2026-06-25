import { type Category, CATEGORY_SET } from '../categories.js';
import type { CandidateRow } from '../db/score.js';

// Чистое ядро ранжирования (T10): детерминированное, без БД и без времени.
// Скор = |пересечение тегов| − штраф за источник представителя; тай-брейки фиксированы.

/** Результат ранжирования для одного кластера (вход рендера T11 / карточки T12). */
export interface ScoredCluster {
  clusterId: number;
  repArticleId: number | null;
  repSource: string | null;
  score: number;
  /** Пересечение interest_tags ∩ cluster.tags, в порядке интересов юзера (для «почему» в T12). */
  matchedTags: Category[];
}

/** Мягкий разбор clusters.tags: только словарные слаги, кривой JSON → []. */
export function parseTags(json: string): Category[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Category => typeof x === 'string' && CATEGORY_SET.has(x));
}

// Промежуточная строка скоринга: ScoredCluster + поля для тай-брейков.
interface Ranked extends ScoredCluster {
  isMajor: number;
  sourceCount: number;
  quality: number;
  updatedAt: number;
}

/**
 * Ранжирует кандидатов под интересы юзера. Шаги: overlap → дроп zero-overlap →
 * дроп заблокированного представителя → score = overlap − max(0, −net) →
 * сортировка (score ↓, is_major ↓, sourceCount ↓, quality ↓, updatedAt ↓, id ↑) → топ-N.
 */
export function rankClusters(
  candidates: CandidateRow[],
  interestTags: Category[],
  blocked: ReadonlySet<string>,
  penalties: ReadonlyMap<string, number>,
  topN: number,
): ScoredCluster[] {
  const ranked: Ranked[] = [];
  for (const c of candidates) {
    const clusterTags = new Set(parseTags(c.tags));
    const matchedTags = interestTags.filter((t) => clusterTags.has(t)); // порядок = интересы юзера
    if (matchedTags.length === 0) continue; // relevance-гейт: дроп zero-overlap
    if (c.repSource !== null && blocked.has(c.repSource)) continue; // дроп заблокированного rep
    const net = c.repSource !== null ? (penalties.get(c.repSource) ?? 0) : 0;
    const penalty = Math.max(0, -net); // лайки (net>0) не бустят
    ranked.push({
      clusterId: c.id,
      repArticleId: c.repArticleId,
      repSource: c.repSource,
      score: matchedTags.length - penalty,
      matchedTags,
      isMajor: c.isMajor,
      sourceCount: c.sourceCount,
      quality: c.quality ?? 0,
      updatedAt: c.updatedAt,
    });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.isMajor - a.isMajor ||
      b.sourceCount - a.sourceCount ||
      b.quality - a.quality ||
      b.updatedAt - a.updatedAt ||
      a.clusterId - b.clusterId,
  );
  return ranked.slice(0, topN).map((r) => ({
    clusterId: r.clusterId,
    repArticleId: r.repArticleId,
    repSource: r.repSource,
    score: r.score,
    matchedTags: r.matchedTags,
  }));
}
