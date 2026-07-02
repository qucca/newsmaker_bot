import type Database from 'better-sqlite3';
import type { UserRow } from '../db/users.js';
import {
  selectCandidateClusters,
  selectBlockedSources,
  selectReasonPenalties,
} from '../db/score.js';
import { rankClusters, type ScoredCluster } from './rank.js';

// Оркестратор ранжирования (T10): тонкая склейка БД-репозитория и чистого ядра.
// windowMs прокидывается извне (T15 = SCORE_WINDOW_HOURS * 3_600_000) — не читаем config здесь.

export interface ScoreDeps {
  windowMs: number; // окно свежести кандидатов в мс
}

/** Строит per-user шорт-лист кластеров (топ-N = user.maxItemsPerSend). Синхронно. */
export function scoreForUser(
  db: Database.Database,
  user: UserRow,
  now: number,
  deps: ScoreDeps,
): ScoredCluster[] {
  const minUpdated = now - deps.windowMs;
  const candidates = selectCandidateClusters(db, user.chatId, minUpdated);
  const blocked = selectBlockedSources(db, user.chatId);
  const penalties = selectReasonPenalties(db, user.chatId);
  return rankClusters(candidates, user.interestTags, blocked, penalties, user.maxItemsPerSend);
}
