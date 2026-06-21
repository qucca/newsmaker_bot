import Parser from 'rss-parser';
import type { RawCandidate, SourceRow } from './types.js';

// Разбор RSS/Atom через rss-parser и маппинг item -> RawCandidate.
// HTTP (conditional GET, таймаут, retry) делаем сами в feed.ts — сюда приходит готовое тело.

/** Минимальный срез полей item, который нам нужен от фида. */
export interface ParsedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
}

const parser = new Parser();

/** Разбирает тело фида (RSS или Atom) в плоский список items. */
export async function parseFeed(xml: string): Promise<ParsedItem[]> {
  const feed = await parser.parseString(xml);
  return feed.items.map((item) => ({
    title: item.title,
    link: item.link,
    isoDate: item.isoDate,
    pubDate: item.pubDate,
  }));
}

/** Издание = хост ссылки без префикса www. При нерабочем URL — fallback (имя фида). */
export function publisherFromUrl(link: string, fallback: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return fallback;
  }
}

/** Дата публикации в epoch ms: предпочитаем isoDate, иначе pubDate; кривая/нет → null. */
export function parsePublishedAt(item: Pick<ParsedItem, 'isoDate' | 'pubDate'>): number | null {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Маппит item в кандидата. null, если нет заголовка или ссылки (без них кандидат бесполезен). */
export function toCandidate(
  item: ParsedItem,
  source: Pick<SourceRow, 'id' | 'name' | 'lang'>,
): RawCandidate | null {
  if (!item.title || !item.link) return null;
  return {
    feedSourceId: source.id,
    source: publisherFromUrl(item.link, source.name),
    lang: source.lang,
    title: item.title,
    link: item.link,
    publishedAt: parsePublishedAt(item),
  };
}
