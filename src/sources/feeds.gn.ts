import { z } from 'zod';
import { GNEWS_TOPICS } from './gnews-url.js';

// Кураторский список L2-фидов Google News (T16). Версионируется в репозитории, переприменяется
// идемпотентно через `npm run seed:sources` (kind='gnews_topic'). URL и имя фида деривируются из
// hl/gl/ceid/topic билдером (gnews-url.ts) — пользователю не надо руками собирать ссылку.
//
// Реальный маппинг язык → hl/gl/ceid даёт пользователь (это контент: «список языков + маппинг
// для Google News», CLAUDE.md). Пока массив пуст: сидинг GN — no-op, всё проходит. Пример ниже.

export const GnFeedSeedSchema = z.object({
  lang: z.string().regex(/^[a-z]{2}$/, 'ISO 639-1, lowercase'),
  hl: z.string().min(1), // язык интерфейса GN, напр. 'en-US'
  gl: z.string().min(1), // страна, напр. 'US'
  ceid: z.string().min(1), // '<gl>:<lang>', напр. 'US:en'
  topic: z.enum(GNEWS_TOPICS),
  categories: z.array(z.string()).default([]),
});

/** Запись на вход (categories можно опустить — подставится []). */
export type GnFeedSeedInput = z.input<typeof GnFeedSeedSchema>;
/** Нормализованная запись после валидации. */
export type GnFeedSeed = z.infer<typeof GnFeedSeedSchema>;

export const FEEDS_GN: GnFeedSeedInput[] = [
  // Пример формата (заполнит пользователь — маппинг язык → hl/gl/ceid):
  // { lang: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'TOP', categories: ['world'] },
  // { lang: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'BUSINESS', categories: ['business'] },
];
