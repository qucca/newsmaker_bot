// Единый источник истины словаря категорий — общий контракт T7 (теги кластера),
// T9 (интересы профиля из онбординга), T10 (ранжирование = пересечение этих множеств).
// НАБОР ПРОВИЗОРНЫЙ: содержимое финализируем на T9 вместе с категориями онбординга.
// Расположен в корне src/, т.к. контракт сквозной, а не привязан к одной стадии.
export const CATEGORIES = [
  'world',
  'politics',
  'business',
  'technology',
  'science',
  'health',
  'sports',
  'culture',
  'entertainment',
  'environment',
  'society',
  'security',
] as const;

export type Category = (typeof CATEGORIES)[number];
