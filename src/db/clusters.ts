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
  regions: string | null;
}

const SELECT_MEMBERS = `
  SELECT id, quality, published_at AS publishedAt, fetched_at AS fetchedAt,
         is_urgent AS isUrgent, is_major AS isMajor, tags, entities, neutral_facts AS neutralFacts,
         regions
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
  regions: string;
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
    content_hash   = @contentHash,
    regions        = @regions
  WHERE id = @clusterId`;

/** Перезаписывает агрегатные поля кластера вычисленными значениями. */
export function updateClusterAggregate(
  db: Database.Database,
  clusterId: number,
  agg: ClusterAggregate,
): void {
  db.prepare(UPDATE_CLUSTER).run({ clusterId, ...agg });
}

const SELECT_REP_SOURCE = `
  SELECT a.source AS source
  FROM clusters c
  JOIN articles a ON a.id = c.rep_article_id
  WHERE c.id = ?`;

/** Издание представителя кластера (что юзер видел в карточке). undefined если нет представителя. */
export function getClusterRepSource(db: Database.Database, clusterId: number): string | undefined {
  const row = db.prepare(SELECT_REP_SOURCE).get(clusterId) as { source: string } | undefined;
  return row?.source;
}

/** Парсит JSON-строку в массив строк. [] при любой ошибке / не-массиве. */
function parseStrings(json: string): string[] {
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const SELECT_REGIONS = `SELECT regions FROM clusters WHERE id = ?`;

/** Коды стран кластера (JSON-массив). [] если кластера нет / битый JSON. */
export function getClusterRegions(db: Database.Database, clusterId: number): string[] {
  const row = db.prepare(SELECT_REGIONS).get(clusterId) as { regions: string } | undefined;
  if (row === undefined) return [];
  return parseStrings(row.regions);
}

export interface ClusterFeedbackFacts {
  tags: string[];
  regions: string[];
  source: string;
}

const SELECT_FEEDBACK_FACTS = `
  SELECT c.tags AS tags, c.regions AS regions, a.source AS source
  FROM clusters c JOIN articles a ON a.id = c.rep_article_id
  WHERE c.id = ?`;

/** Факты карточки для пикера причины: теги/страны кластера + издание представителя. */
export function getClusterFeedbackFacts(
  db: Database.Database,
  clusterId: number,
): ClusterFeedbackFacts | undefined {
  const row = db.prepare(SELECT_FEEDBACK_FACTS).get(clusterId) as
    | { tags: string; regions: string; source: string }
    | undefined;
  if (row === undefined) return undefined;
  return { tags: parseStrings(row.tags), regions: parseStrings(row.regions), source: row.source };
}
