// Типы стадии сбора (T4).

/** Строка реестра фидов (таблица sources), в camelCase. */
export interface SourceRow {
  id: number;
  kind: string;
  name: string;
  url: string;
  lang: string;
  categories: string; // JSON-массив (TEXT)
  enabled: number;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: number | null;
}

/**
 * Сырой кандидат со стадии сбора. В БД НЕ пишется: канонизация URL и вставка в
 * articles — задача T5. Здесь только то, что дал фид.
 */
export interface RawCandidate {
  feedSourceId: number; // sources.id (провенанс)
  source: string; // издание: хост ссылки (fallback — имя фида)
  lang: string; // язык оригинала = sources.lang
  title: string;
  link: string; // исходный URL (канонизация — T5)
  publishedAt: number | null; // epoch ms из фида; null если даты нет
  description: string | null; // RSS-сниппет (вход обогащения T7); null если фид не дал
}
