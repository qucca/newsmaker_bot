import type Database from 'better-sqlite3';
import { selectUnclustered, assignCluster } from '../db/articles.js';
import {
  findCandidateClusters,
  createCluster,
  selectClusterMembers,
  updateClusterAggregate,
} from '../db/clusters.js';
import { createLogger, type Logger } from '../log/index.js';
import { hashNeutralFacts } from './content-hash.js';
import { eventTime, pickCluster, pickRepresentative } from './match.js';

const DEFAULT_YIELD_EVERY = 50; // уступать event loop каждые N статей (не config-параметр)

export interface ClusterDeps {
  windowMs: number; // обязателен: T15 = CLUSTER_WINDOW_HOURS * 3_600_000
  runCap: number; // обязателен: кап статей за прогон
  logger?: Logger;
  yieldEvery?: number;
}

export interface ClusterResult {
  selected: number;
  created: number;
  joined: number;
}

/**
 * Пересчитывает агрегаты кластера из всех его статей (идемпотентно, порядко-независимо):
 * представитель промотирует tags/entities/neutral_facts/quality; флаги = OR; first_seen=MIN,
 * updated_at=MAX по eventTime; content_hash = sha256(neutral_facts представителя).
 * Экспортируется для интеграционных тестов. Бросает, если у кластера нет статей.
 */
export function recomputeCluster(db: Database.Database, clusterId: number): void {
  const members = selectClusterMembers(db, clusterId);
  if (members.length === 0) {
    throw new Error(`recomputeCluster: у кластера ${clusterId} нет статей`);
  }
  const rep = pickRepresentative(members);
  let firstSeen = Infinity;
  let updatedAt = -Infinity;
  let isUrgent = 0;
  let isMajor = 0;
  for (const m of members) {
    const evt = eventTime(m);
    if (evt < firstSeen) firstSeen = evt;
    if (evt > updatedAt) updatedAt = evt;
    if (m.isUrgent === 1) isUrgent = 1;
    if (m.isMajor === 1) isMajor = 1;
  }
  const facts: string[] =
    rep.neutralFacts === null ? [] : (JSON.parse(rep.neutralFacts) as string[]);
  updateClusterAggregate(db, clusterId, {
    tags: rep.tags,
    entities: rep.entities,
    neutralFacts: rep.neutralFacts,
    quality: rep.quality,
    isUrgent,
    isMajor,
    repId: rep.id,
    firstSeen,
    updatedAt,
    contentHash: hashNeutralFacts(facts),
    regions: rep.regions ?? '["GLOBAL"]',
  });
}

/**
 * Глобальный шаг кластеризации: обогащённые статьи без кластера → присоединение к
 * существующему кластеру (тот же непустой cluster_key в окне ~windowMs от first_seen) или
 * новый кластер. Пустой ключ → синглтон (несвязанное не склеивается). Каждая статья —
 * в своей транзакции; цикл уступает event loop. LLM не вызывается.
 */
export async function clusterPending(
  db: Database.Database,
  deps: ClusterDeps,
): Promise<ClusterResult> {
  const logger = deps.logger ?? createLogger('cluster');
  const { windowMs, runCap } = deps;
  const yieldEvery = deps.yieldEvery ?? DEFAULT_YIELD_EVERY;

  const pending = selectUnclustered(db, runCap);
  // Самая ранняя статья формирует first_seen: сортируем по eventTime, тай-брейк id.
  pending.sort((a, b) => eventTime(a) - eventTime(b) || a.id - b.id);

  let created = 0;
  let joined = 0;

  const processOne = db.transaction((a: (typeof pending)[number]): 'created' | 'joined' => {
    const evt = eventTime(a);
    const key = a.clusterKey ?? '';
    if (key === '') {
      const cid = createCluster(db, '', evt);
      assignCluster(db, a.id, cid);
      recomputeCluster(db, cid);
      return 'created';
    }
    const candidates = findCandidateClusters(db, key, evt - windowMs);
    const chosen = pickCluster(candidates, evt, windowMs);
    if (chosen !== null) {
      assignCluster(db, a.id, chosen);
      recomputeCluster(db, chosen);
      return 'joined';
    }
    const cid = createCluster(db, key, evt);
    assignCluster(db, a.id, cid);
    recomputeCluster(db, cid);
    return 'created';
  });

  for (let i = 0; i < pending.length; i++) {
    if (processOne(pending[i]!) === 'created') created++;
    else joined++;
    if ((i + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  logger.info('cluster done', { selected: pending.length, created, joined });
  return { selected: pending.length, created, joined };
}
