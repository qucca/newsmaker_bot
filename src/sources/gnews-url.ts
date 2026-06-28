// Построение URL фидов Google News (T16, L2). Чистые детерминированные функции (тесты —
// gnews-url.test.ts). Фид-URL предсказуем по шаблону: топ-стори по стране/языку или
// тематический раздел; язык задаётся через hl/gl/ceid (рычаг под язык юзера).

/** TOP = топ-стори страны; остальное — тематические разделы Google News. */
export const GNEWS_TOPICS = [
  'TOP',
  'WORLD',
  'NATION',
  'BUSINESS',
  'TECHNOLOGY',
  'ENTERTAINMENT',
  'SPORTS',
  'SCIENCE',
  'HEALTH',
] as const;

export type GnewsTopic = (typeof GNEWS_TOPICS)[number];

export interface GnewsFeedParams {
  hl: string; // язык интерфейса, напр. 'en-US'
  gl: string; // страна, напр. 'US'
  ceid: string; // '<gl>:<lang>', напр. 'US:en'
  topic: GnewsTopic;
}

/**
 * URL RSS-фида Google News. Параметры в фиксированном порядке (hl, gl, ceid) — детерминизм.
 * Двоеточие в ceid оставляем литеральным (GN ждёт 'US:en', не '%3A'; двоеточие допустимо в query).
 */
export function buildGnewsFeedUrl(p: GnewsFeedParams): string {
  const query = `hl=${p.hl}&gl=${p.gl}&ceid=${p.ceid}`;
  if (p.topic === 'TOP') {
    return `https://news.google.com/rss?${query}`;
  }
  return `https://news.google.com/rss/headlines/section/topic/${p.topic}?${query}`;
}

/** Title Case из UPPER-топика: WORLD → World, TECHNOLOGY → Technology. */
function titleCase(topic: GnewsTopic): string {
  return topic.charAt(0) + topic.slice(1).toLowerCase();
}

/** Деривированное имя фида (sources.name) — чтобы контент-нагрузка на пользователя была минимальной. */
export function gnewsFeedName(p: Pick<GnewsFeedParams, 'topic' | 'hl'>): string {
  const label = p.topic === 'TOP' ? 'Top stories' : titleCase(p.topic);
  return `Google News: ${label} (${p.hl})`;
}
