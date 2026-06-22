// Канонизация URL (T5): приводит ссылку к единому виду, чтобы дедуп по
// articles.canonical_url схлопывал разные представления одной статьи в одну запись.
// Чисто детерминированно (см. canonical.test.ts).
//
// Согласованный набор правил («что считается дублем»):
//   * только http/https; схему форсим в https (один фид может отдать http, другой https);
//   * хост lowercase (по RFC регистронезависим), срезаем ведущий www.;
//   * регистр ПУТИ сохраняем (на части сайтов путь регистрозависим);
//   * убираем #fragment и дефолтные порты (:80/:443);
//   * хвостовой '/' срезаем (кроме корня);
//   * из query удаляем ИЗВЕСТНЫЕ трекинг-параметры, остальные оставляем и
//     сортируем — осмысленный id в query (?id=123) не теряем, трекинг-хвосты не дробят URL.
//
// Резолв обёрток (Google News) тут НЕ делаем — L1 даёт чистые URL (это T16).

/** Известные трекинг-параметры (точное совпадение, регистронезависимо). */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'yclid',
  'dclid',
  'msclkid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_openstat',
  'ref',
  'ref_src',
  'cmpid',
  'icid',
]);

/** Префиксы трекинг-параметров (utm_source, at_custom, ...). */
const TRACKING_PREFIXES = ['utm_', 'at_'];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Приводит URL к каноническому виду для дедупа. Возвращает null, если URL не
 * парсится или это не http/https (такой кандидат отбрасывается, не валит прогон).
 */
export function canonicalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  // Схема → https; хост lowercase делает сам URL, снимаем www.
  u.protocol = 'https:';
  u.hostname = u.hostname.replace(/^www\./, '');

  // Дефолтные порты и фрагмент.
  if (u.port === '80' || u.port === '443') u.port = '';
  u.hash = '';

  // Хвостовой слэш (кроме корня).
  if (u.pathname !== '/') {
    const stripped = u.pathname.replace(/\/+$/, '');
    u.pathname = stripped === '' ? '/' : stripped;
  }

  // Трекинг из query вон, остальное отсортировать (детерминированный порядок).
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();

  return u.toString();
}
