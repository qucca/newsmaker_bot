import type Database from 'better-sqlite3';

// Репозиторий кластеров (T8): «глупый» SQL без доменной логики. Доменные правила
// (выбор представителя, окно, content_hash) — в src/cluster. source_count НЕ храним
// (COUNT(DISTINCT source) считают потребители на лету).

/** Кандидат на присоединение: тот же cluster_key, first_seen в окне. */
export interface ClusterCandidateRow {
  id: number;
  firstSeen: number;
}

const FIND_CANDIDATES = `
  SELECT id, first_seen AS firstSeen
  FROM clusters
  WHERE cluster_key = @clusterKey AND first_seen >= @minFirstSeen`;

/** Кластеры с данным ключом, чей first_seen не старше minFirstSeen (= eventTime − WINDOW). */
export function findCandidateClusters(
  db: Database.Database,
  clusterKey: string,
  minFirstSeen: number,
): ClusterCandidateRow[] {
  return db.prepare(FIND_CANDIDATES).all({ clusterKey, minFirstSeen }) as ClusterCandidateRow[];
}

const INSERT_CLUSTER = `
  INSERT INTO clusters (cluster_key, first_seen, updated_at)
  VALUES (@clusterKey, @firstSeen, @updatedAt)`;

/** Создаёт минимальный кластер (ключ + время); агрегаты проставит updateClusterAggregate. */
export function createCluster(db: Database.Database, clusterKey: string, evt: number): number {
  const info = db.prepare(INSERT_CLUSTER).run({ clusterKey, firstSeen: evt, updatedAt: evt });
  return Number(info.lastInsertRowid);
}

/** Член кластера для пересчёта (JSON-поля — строки как в БД). */
export interface ClusterMemberRow {
  id: number;
  quality: number;
  publishedAt: number | null;
  fetchedAt: number;
  isUrgent: number;
  isMajor: number;
  tags: string;
  entities: string;
  neutralFacts: string | null;
}

const SELECT_MEMBERS = `
  SELECT id, quality, published_at AS publishedAt, fetched_at AS fetchedAt,
         is_urgent AS isUrgent, is_major AS isMajor, tags, entities, neutral_facts AS neutralFacts
  FROM articles
  WHERE cluster_id = @clusterId`;

/** Все статьи кластера (вход пересчёта). */
export function selectClusterMembers(db: Database.Database, clusterId: number): ClusterMemberRow[] {
  return db.prepare(SELECT_MEMBERS).all({ clusterId }) as ClusterMemberRow[];
}

/** Вычисленные агрегаты кластера (см. recomputeCluster в src/cluster/index.ts). */
export interface ClusterAggregate {
  tags: string;
  entities: string;
  neutralFacts: string | null;
  quality: number;
  isUrgent: number;
  isMajor: number;
  repId: number;
  firstSeen: number;
  updatedAt: number;
  contentHash: string;
}

const UPDATE_CLUSTER = `
  UPDATE clusters SET
    tags           = @tags,
    entities       = @entities,
    neutral_facts  = @neutralFacts,
    quality        = @quality,
    is_urgent      = @isUrgent,
    is_major       = @isMajor,
    rep_article_id = @repId,
    first_seen     = @firstSeen,
    updated_at     = @updatedAt,
    content_hash   = @contentHash
  WHERE id = @clusterId`;

/** Перезаписывает агрегатные поля кластера вычисленными значениями. */
export function updateClusterAggregate(
  db: Database.Database,
  clusterId: number,
  agg: ClusterAggregate,
): void {
  db.prepare(UPDATE_CLUSTER).run({ clusterId, ...agg });
}
