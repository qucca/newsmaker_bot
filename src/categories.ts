// Единый источник истины словаря категорий — сквозной контракт T7 (теги кластера),
// T9 (интересы профиля), T10 (ранжирование = пересечение множеств).
// Модель: плоский словарь УЗКИХ листьев + UI-группировка + `*_other` catch-all на группу.
// Зонтичных тегов (типа «sports») НЕТ — есть football/basketball/.../sports_other.
// Слаги технические (en); локализованные подписи — в src/bot/i18n.ts по slug.

// Плоский литеральный union всех листьев — источник типобезопасности (и z.enum в T7).
export type Category =
  | 'world_geopolitics' | 'domestic_politics' | 'war_conflict' | 'world_other'
  | 'markets_finance' | 'economy_macro' | 'companies_corporate' | 'crypto' | 'business_other'
  | 'ai' | 'consumer_tech' | 'software_internet' | 'cybersecurity' | 'startups' | 'tech_other'
  | 'space' | 'scientific_research' | 'science_other'
  | 'medicine_health' | 'mental_health' | 'fitness_nutrition' | 'health_other'
  | 'football' | 'basketball' | 'tennis' | 'motorsport' | 'combat_sports' | 'sports_other'
  | 'movies_tv' | 'music' | 'gaming' | 'books' | 'art_culture' | 'celebrities' | 'entertainment_other'
  | 'climate' | 'energy' | 'nature_wildlife' | 'environment_other'
  | 'education' | 'religion' | 'migration' | 'crime_justice' | 'lifestyle' | 'society_other';

export interface CategoryGroup {
  /** Технический ключ группы (для UI-навигации и подписи группы в i18n). */
  group: string;
  leaves: readonly Category[];
}

// Группы определяют и порядок, и состав словаря. CATEGORIES выводится из них ниже.
export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { group: 'politics_world', leaves: ['world_geopolitics', 'domestic_politics', 'war_conflict', 'world_other'] },
  { group: 'business_economy', leaves: ['markets_finance', 'economy_macro', 'companies_corporate', 'crypto', 'business_other'] },
  { group: 'technology', leaves: ['ai', 'consumer_tech', 'software_internet', 'cybersecurity', 'startups', 'tech_other'] },
  { group: 'science', leaves: ['space', 'scientific_research', 'science_other'] },
  { group: 'health', leaves: ['medicine_health', 'mental_health', 'fitness_nutrition', 'health_other'] },
  { group: 'sports', leaves: ['football', 'basketball', 'tennis', 'motorsport', 'combat_sports', 'sports_other'] },
  { group: 'culture_entertainment', leaves: ['movies_tv', 'music', 'gaming', 'books', 'art_culture', 'celebrities', 'entertainment_other'] },
  { group: 'environment', leaves: ['climate', 'energy', 'nature_wildlife', 'environment_other'] },
  { group: 'society', leaves: ['education', 'religion', 'migration', 'crime_justice', 'lifestyle', 'society_other'] },
];

export const CATEGORIES: readonly Category[] = CATEGORY_GROUPS.flatMap((g) => g.leaves);

/** Набор для быстрой проверки принадлежности словарю (мягкое чтение interest_tags). */
export const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);
