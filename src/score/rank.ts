import { type Category, CATEGORY_SET } from '../categories.js';
import type { CandidateRow, ReasonPenalties } from '../db/score.js';

// Чистое ядро ранжирования (T10): детерминированное, без БД и без времени.
// Скор = |пересечение тегов| − суммарный штраф по корзинам; тай-брейки фиксированы.

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

/** Мягкий разбор regions кластера: массив строк, кривой JSON → []. */
export function parseRegions(json: string): string[] {
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const WEIGHT_PAIR = 2;
const WEIGHT_TAG = 1;
const WEIGHT_REGION = 1;
const WEIGHT_SOURCE = 1;

const neg = (net: number | undefined): number => Math.max(0, -(net ?? 0));

// Промежуточная строка скоринга: ScoredCluster + поля для тай-брейков.
interface Ranked extends ScoredCluster {
  isMajor: number;
  sourceCount: number;
  quality: number;
  updatedAt: number;
}

/**
 * Ранжирует кандидатов под интересы юзера. Шаги: overlap → дроп zero-overlap →
 * дроп заблокированного представителя → score = overlap − Σштраф →
 * дроп score ≤ 0 → сортировка (score ↓, is_major ↓, sourceCount ↓, quality ↓, updatedAt ↓, id ↑) → топ-N.
 */
export function rankClusters(
  candidates: CandidateRow[],
  interestTags: Category[],
  blocked: ReadonlySet<string>,
  penalties: ReasonPenalties,
  topN: number,
): ScoredCluster[] {
  const ranked: Ranked[] = [];
  for (const c of candidates) {
    const clusterTags = new Set(parseTags(c.tags));
    const matchedTags = interestTags.filter((tg) => clusterTags.has(tg)); // порядок = интересы юзера
    if (matchedTags.length === 0) continue; // relevance-гейт: дроп zero-overlap
    if (c.repSource !== null && blocked.has(c.repSource)) continue; // дроп заблокированного rep
    const clusterRegions = new Set(parseRegions(c.regions));

    let penalty = 0;
    if (c.repSource !== null) penalty += WEIGHT_SOURCE * neg(penalties.source.get(c.repSource));
    for (const [tg, net] of penalties.tag) if (clusterTags.has(tg as Category)) penalty += WEIGHT_TAG * neg(net);
    for (const [cc, net] of penalties.region) if (clusterRegions.has(cc)) penalty += WEIGHT_REGION * neg(net);
    for (const [key, net] of penalties.pair) {
      const [tg, cc] = key.split('|');
      if (tg !== undefined && cc !== undefined && clusterTags.has(tg as Category) && clusterRegions.has(cc)) {
        penalty += WEIGHT_PAIR * neg(net);
      }
    }

    const score = matchedTags.length - penalty;
    if (score <= 0) continue; // порог-пол: меньше карточек лучше, чем нерелевантные
    ranked.push({
      clusterId: c.id,
      repArticleId: c.repArticleId,
      repSource: c.repSource,
      score,
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
