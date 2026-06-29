import { z } from 'zod';

// Кураторский список L1-фидов (прямые RSS изданий). Версионируется в репозитории и
// переприменяется идемпотентно через `npm run seed:sources`.
//
// Набор «вариант B»: двуязычно (ru+en), только L1, Google News пока off. Каждый URL
// проверен живым зондом (парсится, есть свежие items, есть описание у элементов).
// Принцип отбора: специалист на категорию (издатель ≈ 1 группа), мир/бизнес/tech диверсифицированы
// под кросс-source/кросс-язычный дедуп; EN c политбалансом (BBC + WSJ + Foreign Policy).
//
// ВНИМАНИЕ: `categories` здесь — ДЕКОРАТИВНЫ (для человека/будущего). Маршрутизация идёт по
// LLM-тегам кластера (enrich, T7) ∩ интересы юзера (T10), НЕ по этому полю — оно нигде не читается.

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
  // ===== EN (20) — специалист на категорию; политбаланс на мир: BBC(лево)+Fox(право)+Foreign Policy =====
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en', categories: ['world_geopolitics', 'war_conflict'] },
  { name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/world.xml', lang: 'en', categories: ['world_geopolitics', 'elections_government'] },
  { name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/', lang: 'en', categories: ['world_geopolitics', 'elections_government'] },
  { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', lang: 'en', categories: ['markets_finance', 'companies_corporate'] },
  { name: 'Fortune', url: 'https://fortune.com/feed/', lang: 'en', categories: ['companies_corporate', 'economy_macro'] },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', categories: ['consumer_tech', 'software_internet', 'ai'] },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', categories: ['software_internet', 'cybersecurity', 'ai'] },
  { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', lang: 'en', categories: ['scientific_research'] },
  { name: 'Space.com', url: 'https://www.space.com/feeds/all', lang: 'en', categories: ['space'] },
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', lang: 'en', categories: ['medicine_health', 'mental_health'] },
  { name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', lang: 'en', categories: ['football', 'motorsport', 'tennis'] },
  { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/', lang: 'en', categories: ['basketball', 'football'] },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', lang: 'en', categories: ['gaming', 'esports'] },
  { name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', lang: 'en', categories: ['movies_tv', 'celebrities'] },
  { name: 'Pitchfork', url: 'https://pitchfork.com/rss/news/', lang: 'en', categories: ['music'] },
  { name: 'Grist', url: 'https://grist.org/feed/', lang: 'en', categories: ['climate', 'energy', 'nature_wildlife'] },
  { name: 'Condé Nast Traveler', url: 'https://www.cntraveler.com/feed/rss', lang: 'en', categories: ['travel'] },
  { name: 'Eater', url: 'https://www.eater.com/rss/index.xml', lang: 'en', categories: ['food_drink'] },
  { name: 'Hypebeast', url: 'https://hypebeast.com/feed', lang: 'en', categories: ['fashion_style'] },
  { name: 'Motor1', url: 'https://www.motor1.com/rss/news/all/', lang: 'en', categories: ['autos'] },

  // ===== RU (15) — независимые + деловые, без госмедиа. Meduza/BBC Russian — мировые якоря =====
  { name: 'Meduza', url: 'https://meduza.io/rss/all', lang: 'ru', categories: ['world_geopolitics', 'elections_government', 'war_conflict'] },
  { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', lang: 'ru', categories: ['world_geopolitics', 'war_conflict'] },
  { name: 'Holod', url: 'https://holod.media/feed/', lang: 'ru', categories: ['crime_justice', 'migration'] },
  { name: 'RBC', url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss', lang: 'ru', categories: ['markets_finance', 'economy_macro', 'companies_corporate'] },
  { name: 'Forbes.ru', url: 'https://www.forbes.ru/newrss.xml', lang: 'ru', categories: ['companies_corporate', 'personal_finance'] },
  { name: 'Frank Media', url: 'https://frankmedia.ru/feed', lang: 'ru', categories: ['markets_finance', 'personal_finance'] },
  { name: 'VC.ru', url: 'https://vc.ru/rss', lang: 'ru', categories: ['startups', 'software_internet'] },
  { name: 'Habr', url: 'https://habr.com/ru/rss/news/?fl=ru', lang: 'ru', categories: ['software_internet', 'ai', 'consumer_tech'] },
  { name: '3DNews', url: 'https://3dnews.ru/news/rss/', lang: 'ru', categories: ['consumer_tech'] },
  { name: 'Naked Science', url: 'https://naked-science.ru/feed', lang: 'ru', categories: ['scientific_research', 'space'] },
  { name: 'Sports.ru', url: 'https://www.sports.ru/rss/all_news.xml', lang: 'ru', categories: ['football', 'basketball', 'tennis'] },
  { name: 'Championat', url: 'https://www.championat.com/rss/news/', lang: 'ru', categories: ['football', 'motorsport'] },
  { name: 'DTF', url: 'https://dtf.ru/rss', lang: 'ru', categories: ['gaming', 'movies_tv'] },
  { name: 'StopGame', url: 'https://rss.stopgame.ru/rss_news.xml', lang: 'ru', categories: ['gaming', 'esports'] },
  { name: 'Afisha Daily', url: 'https://daily.afisha.ru/rss/', lang: 'ru', categories: ['movies_tv', 'music', 'food_drink'] },
];
