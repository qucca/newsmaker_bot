// Единый источник истины словаря категорий — сквозной контракт T7 (теги кластера),
// T9 (интересы профиля), T10 (ранжирование = пересечение множеств).
// Модель: плоский словарь УЗКИХ листьев + UI-группировка + один catch-all `*_other` на группу.
// Зонтичных тегов (типа «sports») НЕТ — есть football/basketball/.../sports_other.
// Слаги технические (en); локализованные подписи — в src/bot/i18n.ts по slug.
//
// catch-all (`*_other`) — ТЕГИРОВАНИЕ-ТОЛЬКО: enrich может присвоить его, когда ничего
// конкретного не подходит, но в онбординге он НЕ показывается (P2a). Контент, помеченный
// только catch-all'ом, осознанно не маршрутизируется (его никто не может выбрать интересом).
// Поэтому два словаря: CATEGORIES (полный, для enrich-enum/валидации) и
// SELECTABLE_CATEGORIES (только листья, для онбординга).

// Плоский литеральный union всех слагов — источник типобезопасности (и z.enum в T7).
export type Category =
  // politics_world
  | 'world_geopolitics' | 'elections_government' | 'war_conflict' | 'world_other'
  // business_economy
  | 'markets_finance' | 'economy_macro' | 'companies_corporate' | 'crypto' | 'personal_finance' | 'real_estate' | 'business_other'
  // technology
  | 'ai' | 'consumer_tech' | 'software_internet' | 'cybersecurity' | 'startups' | 'tech_other'
  // science
  | 'space' | 'scientific_research' | 'science_other'
  // health
  | 'medicine_health' | 'mental_health' | 'fitness_nutrition' | 'health_other'
  // sports
  | 'football' | 'basketball' | 'tennis' | 'motorsport' | 'combat_sports' | 'sports_other'
  // culture_entertainment
  | 'movies_tv' | 'music' | 'gaming' | 'esports' | 'books' | 'art_culture' | 'celebrities' | 'entertainment_other'
  // environment
  | 'climate' | 'energy' | 'nature_wildlife' | 'weather_disasters' | 'environment_other'
  // society
  | 'education' | 'religion' | 'migration' | 'crime_justice' | 'society_other'
  // lifestyle
  | 'travel' | 'food_drink' | 'fashion_style' | 'autos' | 'lifestyle_other';

export interface CategoryGroup {
  /** Технический ключ группы (для UI-навигации и подписи группы в i18n). */
  group: string;
  /** Выбираемые в онбординге листья (БЕЗ catch-all). */
  leaves: readonly Category[];
  /** Catch-all группы: enrich может тегировать, но в онбординге не показывается (P2a). */
  catchAll: Category;
}

// Группы определяют и порядок, и состав словаря. CATEGORIES/SELECTABLE_CATEGORIES выводятся ниже.
export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { group: 'politics_world', leaves: ['world_geopolitics', 'elections_government', 'war_conflict'], catchAll: 'world_other' },
  { group: 'business_economy', leaves: ['markets_finance', 'economy_macro', 'companies_corporate', 'crypto', 'personal_finance', 'real_estate'], catchAll: 'business_other' },
  { group: 'technology', leaves: ['ai', 'consumer_tech', 'software_internet', 'cybersecurity', 'startups'], catchAll: 'tech_other' },
  { group: 'science', leaves: ['space', 'scientific_research'], catchAll: 'science_other' },
  { group: 'health', leaves: ['medicine_health', 'mental_health', 'fitness_nutrition'], catchAll: 'health_other' },
  { group: 'sports', leaves: ['football', 'basketball', 'tennis', 'motorsport', 'combat_sports'], catchAll: 'sports_other' },
  { group: 'culture_entertainment', leaves: ['movies_tv', 'music', 'gaming', 'esports', 'books', 'art_culture', 'celebrities'], catchAll: 'entertainment_other' },
  { group: 'environment', leaves: ['climate', 'energy', 'nature_wildlife', 'weather_disasters'], catchAll: 'environment_other' },
  { group: 'society', leaves: ['education', 'religion', 'migration', 'crime_justice'], catchAll: 'society_other' },
  { group: 'lifestyle', leaves: ['travel', 'food_drink', 'fashion_style', 'autos'], catchAll: 'lifestyle_other' },
];

/** Полный словарь (выбираемые листья + catch-all): enrich-enum (T7), валидация тегов/интересов. */
export const CATEGORIES: readonly Category[] = CATEGORY_GROUPS.flatMap((g) => [...g.leaves, g.catchAll]);

/** Выбираемые в онбординге (T9): только листья, без catch-all'ов (P2a). */
export const SELECTABLE_CATEGORIES: readonly Category[] = CATEGORY_GROUPS.flatMap((g) => g.leaves);

/** Набор для быстрой проверки принадлежности полному словарю (мягкое чтение тегов/интересов). */
export const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

/** Набор выбираемых интересов — строгая валидация тапа в онбординге/настройках (catch-all не пройдёт). */
export const SELECTABLE_CATEGORY_SET: ReadonlySet<string> = new Set(SELECTABLE_CATEGORIES);
