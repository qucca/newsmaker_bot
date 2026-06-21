import { z } from 'zod';

// Кураторский список L1-фидов (прямые RSS изданий). Версионируется в репозитории и
// переприменяется идемпотентно через `npm run seed:sources`.
//
// Реальный список (по горстке надёжных изданий на каждый поддерживаемый язык) даёт
// пользователь — это контент, не код. Пока массив пуст: сидинг будет no-op, тесты и
// скрипт уже работают. Формат записи — в примере ниже.

export const FeedSeedSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  lang: z.string().regex(/^[a-z]{2}$/, 'ISO 639-1, lowercase'),
  categories: z.array(z.string()).default([]),
});

/** Запись на вход (categories можно опустить — подставится []). */
export type FeedSeedInput = z.input<typeof FeedSeedSchema>;
/** Нормализованная запись после валидации. */
export type FeedSeed = z.infer<typeof FeedSeedSchema>;

export const FEEDS_L1: FeedSeedInput[] = [
  // Пример формата (заполнит пользователь):
  // { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', lang: 'en', categories: ['world'] },
];
