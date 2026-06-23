# T7 — Глобальное обогащение (`src/enrich`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один батч-проход, который обогащает новых кандидатов (`articles.enriched_at IS NULL`) через LLM (нейтральные факты, сущности, теги, quality, флаги) и пишет результат обратно в `articles`.

**Architecture:** Сбор RSS (T4) дополняется сохранением описания статьи. Детерминированные модули (словарь категорий, вывод `cluster_key`, zod-схема, сборка промпта) изолированы и юнит-тестируются. Оркестратор `enrichPending` выбирает необогащённых, бьёт на чанки, на каждый чанк делает один `generateStructured` (zod + 1 ретрай внутри клиента), на провале изолирует чанк (лог + пропуск), на успехе пишет поля в транзакции. Кластеры (`clusters`) не трогаются — это T8.

**Tech Stack:** TypeScript (strict), Node 24.x, better-sqlite3 (синхронный), zod, провайдеро-независимый LLM-слой `src/llm`, тесты `node:test` + `tsx`.

## Global Constraints

- TypeScript strict; никакого `any` без явного обоснования в комментарии.
- Только npm; Node 24.x (`engines`).
- LLM — только через `src/llm` `generateStructured` (structured output + zod + 1 ретрай). **Никакого парсинга ответа регэкспами.**
- Тесты: `node:test` + `tsx`, colocated `*.test.ts`, исключены из сборки.
- В логи НЕ попадают секреты, заголовки/контент статей и персональные данные.
- `better-sqlite3` синхронный — записи в транзакции; между чанками естественно уступаем event loop (await LLM).
- `neutral_facts` — на языке оригинала; `entities`/`cluster_key` — язык-независимые (канонические англ. имена).
- Теги — только из фиксированного словаря (`src/categories.ts`).
- **Коммиты отложены по просьбе пользователя.** Шаги `git commit` НЕ выполнять; вместо коммита прогонять `npm run lint` + `npx tsx --test`.

---

## File Structure

- `migrations/0002_articles_description.sql` — новая колонка `articles.description`.
- `src/sources/parse.ts` — извлечение/усечение описания из RSS (модификация).
- `src/sources/types.ts` — `RawCandidate.description` (модификация).
- `src/sources/persist.ts` — проброс описания в `ArticleInsert` (модификация).
- `src/db/articles.ts` — `ArticleInsert.description`, `selectUnenriched`, `writeEnrichment` (модификация).
- `src/categories.ts` — единый словарь категорий + тип (создание).
- `src/enrich/cluster-key.ts` — `deriveClusterKey` (создание).
- `src/enrich/schema.ts` — zod `EnrichItem` + `makeBatchSchema` (создание).
- `src/enrich/prompt.ts` — `buildEnrichPrompt` (создание).
- `src/enrich/index.ts` — `enrichPending` + `resolveEnrichClient` (создание).
- `src/config/index.ts` — env `MAX_ENRICH_BATCH`, `ENRICH_RUN_CAP` (модификация).
- `.env.example` — новые переменные (модификация).

---

### Task 1: Сохранение RSS-описания (фид → БД)

Вертикальный срез: фид даёт описание → парсер усекает → попадает в `articles.description`. Все файлы тесно связаны типом `ArticleInsert`, поэтому одна задача.

**Files:**
- Create: `migrations/0002_articles_description.sql`
- Modify: `src/sources/parse.ts`
- Modify: `src/sources/types.ts`
- Modify: `src/sources/persist.ts`
- Modify: `src/db/articles.ts`
- Test: `src/sources/parse.test.ts`, `src/db/articles.test.ts`

**Interfaces:**
- Produces:
  - `extractDescription(item: { contentSnippet?: string; content?: string }): string | null`
  - `MAX_DESCRIPTION_CHARS = 1000` (const в `parse.ts`)
  - `RawCandidate.description: string | null`
  - `ArticleInsert.description: string | null`

- [ ] **Step 1: Failing-тест на извлечение описания**

В `src/sources/parse.test.ts` добавить:

```ts
import { extractDescription, MAX_DESCRIPTION_CHARS, toCandidate } from './parse.js';

test('extractDescription: берёт contentSnippet как есть', () => {
  assert.equal(extractDescription({ contentSnippet: '  Привет мир  ' }), 'Привет мир');
});

test('extractDescription: фолбэк на content со снятием тегов', () => {
  assert.equal(extractDescription({ content: '<p>Hello <b>world</b></p>' }), 'Hello world');
});

test('extractDescription: нет ни того ни другого → null', () => {
  assert.equal(extractDescription({}), null);
});

test('extractDescription: пустая строка → null', () => {
  assert.equal(extractDescription({ contentSnippet: '   ' }), null);
});

test('extractDescription: усекает до MAX_DESCRIPTION_CHARS', () => {
  const long = 'x'.repeat(MAX_DESCRIPTION_CHARS + 50);
  assert.equal(extractDescription({ contentSnippet: long }).length, MAX_DESCRIPTION_CHARS);
});

test('toCandidate: проставляет description из item', () => {
  const c = toCandidate(
    { title: 'T', link: 'https://e.com/a', contentSnippet: 'snippet' },
    { id: 1, name: 'A', lang: 'en' },
  );
  assert.equal(c?.description, 'snippet');
});
```

- [ ] **Step 2: Прогнать — тест падает**

Run: `npx tsx --test src/sources/parse.test.ts`
Expected: FAIL — `extractDescription`/`MAX_DESCRIPTION_CHARS` не экспортированы; `c.description` отсутствует.

- [ ] **Step 3: Реализовать парсер описания**

В `src/sources/parse.ts`:

```ts
/** Минимальный срез полей item, который нам нужен от фида. */
export interface ParsedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string; // plain-text сниппет (rss-parser снимает теги сам)
  content?: string; // HTML; фолбэк, если нет сниппета
}
```

В `parseFeed` маппинге добавить два поля:

```ts
  return feed.items.map((item) => ({
    title: item.title,
    link: item.link,
    isoDate: item.isoDate,
    pubDate: item.pubDate,
    contentSnippet: item.contentSnippet,
    content: item.content,
  }));
```

Добавить (после `publisherFromUrl`):

```ts
/** Кап длины описания-кандидата: вход обогащения, не полный текст (копирайт). */
export const MAX_DESCRIPTION_CHARS = 1000;

/** Снимает HTML-теги и схлопывает пробелы (фолбэк для content без сниппета). */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Описание кандидата: contentSnippet, иначе content без тегов; усечён; пустое → null. */
export function extractDescription(
  item: Pick<ParsedItem, 'contentSnippet' | 'content'>,
): string | null {
  const raw =
    item.contentSnippet ?? (item.content !== undefined ? stripHtml(item.content) : undefined);
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_DESCRIPTION_CHARS ? trimmed.slice(0, MAX_DESCRIPTION_CHARS) : trimmed;
}
```

В `toCandidate` добавить поле в возвращаемый объект:

```ts
  return {
    feedSourceId: source.id,
    source: publisherFromUrl(item.link, source.name),
    lang: source.lang,
    title: item.title,
    link: item.link,
    publishedAt: parsePublishedAt(item),
    description: extractDescription(item),
  };
```

В `src/sources/types.ts` в `RawCandidate` добавить поле:

```ts
  publishedAt: number | null; // epoch ms из фида; null если даты нет
  description: string | null; // RSS-сниппет (вход обогащения T7); null если фид не дал
```

- [ ] **Step 4: Прогнать — тесты парсера зелёные**

Run: `npx tsx --test src/sources/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing-тест на сохранение описания в БД**

В `src/db/articles.test.ts` обновить `row()` (добавить дефолт) и `readArticles`, затем добавить тест:

```ts
function row(over: Partial<ArticleInsert> = {}): ArticleInsert {
  return {
    canonicalUrl: 'https://e.com/a',
    source: 'e.com',
    feedSourceId: null,
    lang: 'en',
    title: 'Title',
    publishedAt: 1000,
    fetchedAt: 2000,
    description: null,
    ...over,
  };
}

test('insertArticles: сохраняет description', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', description: 'snippet' })]);
  const r = db
    .prepare(`SELECT description FROM articles WHERE canonical_url = 'https://e.com/a'`)
    .get() as Record<string, unknown>;
  assert.equal(r.description, 'snippet');
  db.close();
});

test('insertArticles: description=null сохраняется как NULL', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/b', description: null })]);
  const r = db
    .prepare(`SELECT description FROM articles WHERE canonical_url = 'https://e.com/b'`)
    .get() as Record<string, unknown>;
  assert.equal(r.description, null);
  db.close();
});
```

- [ ] **Step 6: Прогнать — падает на отсутствии колонки/поля**

Run: `npx tsx --test src/db/articles.test.ts`
Expected: FAIL — нет колонки `description` и поля в `ArticleInsert`.

- [ ] **Step 7: Миграция + DB-плумбинг + persist**

Создать `migrations/0002_articles_description.sql`:

```sql
-- Миграция 0002: вход обогащения (T7) — описание кандидата из RSS.
-- Нейтральные факты строятся из description + title. Полный текст оригинала НЕ храним
-- (копирайт): парсер усекает до кап ~1000 символов. nullable: фид мог не дать описания.
ALTER TABLE articles ADD COLUMN description TEXT;
```

В `src/db/articles.ts` — `ArticleInsert` и `INSERT_ARTICLE`:

```ts
export interface ArticleInsert {
  canonicalUrl: string;
  source: string;
  feedSourceId: number | null;
  lang: string | null;
  title: string;
  publishedAt: number | null;
  fetchedAt: number; // epoch ms
  description: string | null; // RSS-сниппет, вход обогащения T7
}

const INSERT_ARTICLE = `
  INSERT INTO articles (canonical_url, source, feed_source_id, lang, title, published_at, fetched_at, description)
  VALUES (@canonicalUrl, @source, @feedSourceId, @lang, @title, @publishedAt, @fetchedAt, @description)
  ON CONFLICT (canonical_url) DO NOTHING`;
```

В `src/sources/persist.ts` в `rows.push({...})` добавить:

```ts
    rows.push({
      canonicalUrl,
      source: c.source,
      feedSourceId: c.feedSourceId,
      lang: c.lang,
      title: c.title,
      publishedAt: c.publishedAt,
      fetchedAt: now(),
      description: c.description,
    });
```

В `src/sources/persist.test.ts` обновить `cand()` — добавить `description: null` в дефолт (иначе тип не сойдётся).

- [ ] **Step 8: Прогнать БД + sources тесты — зелёные**

Run: `npx tsx --test src/db/articles.test.ts src/sources/parse.test.ts src/sources/persist.test.ts`
Expected: PASS.

- [ ] **Step 9: Lint + полный прогон тестов (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS. (Коммит отложен — не выполнять.)

---

### Task 2: Словарь категорий (`src/categories.ts`)

**Files:**
- Create: `src/categories.ts`
- Test: `src/categories.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES: readonly [...] as const` (12 slug'ов)
  - `type Category = (typeof CATEGORIES)[number]`

- [ ] **Step 1: Failing-тест**

`src/categories.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CATEGORIES } from './categories.js';

test('CATEGORIES: 12 уникальных провизорных категорий', () => {
  assert.equal(CATEGORIES.length, 12);
  assert.equal(new Set(CATEGORIES).size, 12);
  assert.ok(CATEGORIES.includes('world'));
  assert.ok(CATEGORIES.includes('technology'));
});

test('CATEGORIES: годится как источник для z.enum', () => {
  const e = z.enum(CATEGORIES);
  assert.equal(e.safeParse('sports').success, true);
  assert.equal(e.safeParse('nonsense').success, false);
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/categories.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать словарь**

`src/categories.ts`:

```ts
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
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 3: Вывод cluster_key (`src/enrich/cluster-key.ts`)

**Files:**
- Create: `src/enrich/cluster-key.ts`
- Test: `src/enrich/cluster-key.test.ts`

**Interfaces:**
- Produces: `deriveClusterKey(entities: string[]): string`

- [ ] **Step 1: Failing-тест**

`src/enrich/cluster-key.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveClusterKey } from './cluster-key.js';

test('deriveClusterKey: lowercase, сортировка, склейка через |', () => {
  assert.equal(deriveClusterKey(['NATO', 'Ukraine']), 'nato|ukraine');
});

test('deriveClusterKey: убирает диакритику и пунктуацию', () => {
  assert.equal(deriveClusterKey(['São Paulo', 'U.S.A.']), 'sao paulo|usa');
});

test('deriveClusterKey: дедуп после нормализации', () => {
  assert.equal(deriveClusterKey(['Apple', 'apple']), 'apple');
});

test('deriveClusterKey: топ-5 по порядку значимости, потом сортировка', () => {
  // 6 сущностей → берём первые 5 (e6 отбрасывается), затем сортируем
  assert.equal(deriveClusterKey(['e5', 'e4', 'e3', 'e2', 'e1', 'zz']), 'e1|e2|e3|e4|e5');
});

test('deriveClusterKey: пустой вход → пустой ключ', () => {
  assert.equal(deriveClusterKey([]), '');
});

test('deriveClusterKey: сущности, ставшие пустыми после нормализации, отброшены', () => {
  assert.equal(deriveClusterKey(['!!!', 'Tesla']), 'tesla');
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/enrich/cluster-key.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

`src/enrich/cluster-key.ts`:

```ts
// Детерминированный вывод язык-независимого ключа кластера из топ-сущностей.
// Используется T7 (заполнить articles.cluster_key) и переиспользуется T8 (матчинг в окне).
// Правило (docs/design.md): нормализованный набор топ-сущностей, lowercase, отсортировать, склеить.

const TOP_K = 5;

/** Нормализация одной сущности: lowercase, снять диакритику, убрать пунктуацию, схлопнуть пробелы. */
function normalize(entity: string): string {
  return entity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // диакритические знаки
    .replace(/[^a-z0-9\s]/g, '') // оставляем буквы/цифры/пробелы
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ключ кластера из сущностей (по убыванию значимости на входе): нормализуем, отбрасываем
 * пустые, дедупим с сохранением порядка, берём топ-K, сортируем и склеиваем через '|'.
 * Пустой вход (или всё отнормализовалось в пусто) → пустой ключ (такая статья не матчится).
 */
export function deriveClusterKey(entities: string[]): string {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const e of entities) {
    const n = normalize(e);
    if (n.length === 0 || seen.has(n)) continue;
    seen.add(n);
    normalized.push(n);
  }
  return normalized.slice(0, TOP_K).sort().join('|');
}
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/enrich/cluster-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 4: zod-схема обогащения (`src/enrich/schema.ts`)

**Files:**
- Create: `src/enrich/schema.ts`
- Test: `src/enrich/schema.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES` (Task 2)
- Produces:
  - `EnrichItemSchema` (zod), `type EnrichItem` (с полями `ref, entities, tags, quality, is_urgent, is_major, neutral_facts`)
  - `makeBatchSchema(refs: number[]): z.ZodType<EnrichItem[]>`

- [ ] **Step 1: Failing-тест**

`src/enrich/schema.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichItemSchema, makeBatchSchema } from './schema.js';

function item(over: Record<string, unknown> = {}) {
  return {
    ref: 0,
    entities: ['NATO'],
    tags: ['world'],
    quality: 80,
    is_urgent: false,
    is_major: true,
    neutral_facts: ['Fact one.', 'Fact two.'],
    ...over,
  };
}

test('EnrichItemSchema: валидный объект проходит', () => {
  assert.equal(EnrichItemSchema.safeParse(item()).success, true);
});

test('EnrichItemSchema: тег вне словаря отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ tags: ['nonsense'] })).success, false);
});

test('EnrichItemSchema: quality вне 0..100 отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ quality: 200 })).success, false);
});

test('EnrichItemSchema: <2 нейтральных фактов отклоняется', () => {
  assert.equal(EnrichItemSchema.safeParse(item({ neutral_facts: ['only one'] })).success, false);
});

test('makeBatchSchema: проходит при совпадении refs', () => {
  const schema = makeBatchSchema([0, 1]);
  const res = schema.safeParse([item({ ref: 0 }), item({ ref: 1 })]);
  assert.equal(res.success, true);
});

test('makeBatchSchema: рассинхрон количества отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 })]).success, false);
});

test('makeBatchSchema: неизвестный ref отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 }), item({ ref: 9 })]).success, false);
});

test('makeBatchSchema: дублирующийся ref отклоняется', () => {
  const schema = makeBatchSchema([0, 1]);
  assert.equal(schema.safeParse([item({ ref: 0 }), item({ ref: 0 })]).success, false);
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/enrich/schema.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

`src/enrich/schema.ts`:

```ts
import { z } from 'zod';
import { CATEGORIES } from '../categories.js';

/** Один обогащённый кандидат (выход LLM). ref = индекс статьи во входном батче. */
export const EnrichItemSchema = z.object({
  ref: z.number().int().nonnegative(),
  entities: z.array(z.string().min(1)).min(1).max(6), // канонические, по убыванию значимости
  tags: z.array(z.enum(CATEGORIES)).max(4), // только из словаря; 0..4
  quality: z.number().int().min(0).max(100), // содержательность
  is_urgent: z.boolean(),
  is_major: z.boolean(),
  neutral_facts: z.array(z.string().min(1)).min(2).max(6), // на языке оригинала
});

export type EnrichItem = z.infer<typeof EnrichItemSchema>;

/**
 * Схема ответа на чанк: массив EnrichItem, у которого набор ref в точности совпадает
 * со входом (по количеству и значениям, без дублей). Рассинхрон → провал схемы → ретрай
 * клиента; повторный провал ловит оркестратор и пропускает чанк.
 */
export function makeBatchSchema(refs: number[]): z.ZodType<EnrichItem[]> {
  const expected = new Set(refs);
  return z.array(EnrichItemSchema).superRefine((items, ctx) => {
    if (items.length !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected ${refs.length} items, got ${items.length}`,
      });
    }
    const seen = new Set<number>();
    for (const it of items) {
      if (!expected.has(it.ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unexpected ref ${it.ref}` });
      }
      if (seen.has(it.ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ref ${it.ref}` });
      }
      seen.add(it.ref);
    }
  });
}
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/enrich/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 5: Сборка промпта (`src/enrich/prompt.ts`)

**Files:**
- Create: `src/enrich/prompt.ts`
- Test: `src/enrich/prompt.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES` (Task 2), `PromptBlock` (`src/llm`)
- Produces:
  - `interface EnrichInput { ref: number; source: string; lang: string | null; title: string; description: string | null }`
  - `buildEnrichPrompt(batch: EnrichInput[]): { system: PromptBlock[]; input: PromptBlock[] }`

- [ ] **Step 1: Failing-тест**

`src/enrich/prompt.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnrichPrompt, type EnrichInput } from './prompt.js';
import { CATEGORIES } from '../categories.js';

const batch: EnrichInput[] = [
  { ref: 0, source: 'e.com', lang: 'en', title: 'Title A', description: 'desc A' },
  { ref: 1, source: 'r.ru', lang: null, title: 'Заголовок Б', description: null },
];

test('buildEnrichPrompt: системный блок кешируемый и перечисляет все категории', () => {
  const { system } = buildEnrichPrompt(batch);
  assert.equal(system.length, 1);
  assert.equal(system[0].cache, true);
  for (const cat of CATEGORIES) assert.ok(system[0].text.includes(cat));
});

test('buildEnrichPrompt: input — это JSON батча с теми же ref', () => {
  const { input } = buildEnrichPrompt(batch);
  assert.equal(input.length, 1);
  const parsed = JSON.parse(input[0].text) as EnrichInput[];
  assert.deepEqual(
    parsed.map((p) => p.ref),
    [0, 1],
  );
  assert.equal(parsed[1].lang, null);
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/enrich/prompt.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

`src/enrich/prompt.ts`:

```ts
import type { PromptBlock } from '../llm/index.js';
import { CATEGORIES } from '../categories.js';

/** Вход одной статьи в батч обогащения. ref — индекс статьи в чанке. */
export interface EnrichInput {
  ref: number;
  source: string;
  lang: string | null;
  title: string;
  description: string | null;
}

// Системная инструкция стабильна между прогонами → помечаем cache:true (кеш промпта).
const SYSTEM_TEXT = [
  'You enrich news article candidates for a multilingual news bot.',
  'You receive a JSON array of articles. For EACH article return ONE JSON object.',
  'Return a JSON array with EXACTLY one object per input article and the SAME `ref` values.',
  '',
  'Per-article fields:',
  '- ref: integer — echo the input `ref` unchanged.',
  '- entities: 1..6 canonical entity names, most salient first. Use the common ENGLISH name',
  '  where one exists (people, orgs, places), so the same story in different languages maps together.',
  '- tags: 0..4 topic tags chosen ONLY from this fixed list (omit anything that does not fit):',
  `  ${CATEGORIES.join(', ')}.`,
  '- quality: integer 0..100 — substantiveness of the item: a real, informative news story scores high;',
  '  clickbait, ads/sponsored, listicles, pure opinion score low.',
  '- is_urgent: boolean — breaking / time-sensitive news.',
  '- is_major: boolean — large-scale world event.',
  '- neutral_facts: 2..6 short, neutral factual statements about WHAT HAPPENED,',
  '  written IN THE ORIGINAL LANGUAGE of the article (the `lang` field; if lang is null,',
  '  infer the language from title/description). No opinion, no source bias, no summary framing.',
].join('\n');

/** Строит system (кешируемый) и input блоки для одного чанка обогащения. */
export function buildEnrichPrompt(batch: EnrichInput[]): {
  system: PromptBlock[];
  input: PromptBlock[];
} {
  return {
    system: [{ text: SYSTEM_TEXT, cache: true }],
    input: [{ text: JSON.stringify(batch) }],
  };
}
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/enrich/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 6: Репозиторий обогащения (`selectUnenriched`, `writeEnrichment`)

**Files:**
- Modify: `src/db/articles.ts`
- Test: `src/db/articles.test.ts`

**Interfaces:**
- Produces:
  - `interface UnenrichedArticle { id: number; source: string; lang: string | null; title: string; description: string | null }`
  - `selectUnenriched(db, limit: number): UnenrichedArticle[]`
  - `interface EnrichmentWrite { id: number; clusterKey: string; entities: string[]; tags: string[]; quality: number; isUrgent: boolean; isMajor: boolean; neutralFacts: string[]; enrichedAt: number }`
  - `writeEnrichment(db, rows: EnrichmentWrite[]): { updated: number }`

- [ ] **Step 1: Failing-тест**

В `src/db/articles.test.ts` добавить:

```ts
import {
  insertArticles,
  selectUnenriched,
  writeEnrichment,
  type ArticleInsert,
  type EnrichmentWrite,
} from './articles.js';

function enrichRow(over: Partial<EnrichmentWrite> = {}): EnrichmentWrite {
  return {
    id: 0,
    clusterKey: 'nato|ukraine',
    entities: ['NATO', 'Ukraine'],
    tags: ['world'],
    quality: 75,
    isUrgent: false,
    isMajor: true,
    neutralFacts: ['Fact one.', 'Fact two.'],
    enrichedAt: 5000,
    ...over,
  };
}

test('selectUnenriched: возвращает только необогащённых, по id, с лимитом', () => {
  const db = memDb();
  insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a', title: 'A' }),
    row({ canonicalUrl: 'https://e.com/b', title: 'B' }),
    row({ canonicalUrl: 'https://e.com/c', title: 'C' }),
  ]);
  const all = selectUnenriched(db, 10);
  assert.equal(all.length, 3);
  assert.equal(all[0].title, 'A');
  const limited = selectUnenriched(db, 2);
  assert.equal(limited.length, 2);
  db.close();
});

test('writeEnrichment: пишет поля, ставит enriched_at и убирает из необогащённых', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', description: 'd' })]);
  const id = selectUnenriched(db, 10)[0].id;
  const res = writeEnrichment(db, [enrichRow({ id })]);
  assert.equal(res.updated, 1);
  const r = db
    .prepare(
      `SELECT enriched_at, cluster_key, entities, tags, quality, is_urgent, is_major, neutral_facts FROM articles WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>;
  assert.equal(r.enriched_at, 5000);
  assert.equal(r.cluster_key, 'nato|ukraine');
  assert.deepEqual(JSON.parse(r.entities as string), ['NATO', 'Ukraine']);
  assert.deepEqual(JSON.parse(r.tags as string), ['world']);
  assert.equal(r.quality, 75);
  assert.equal(r.is_urgent, 0);
  assert.equal(r.is_major, 1);
  assert.deepEqual(JSON.parse(r.neutral_facts as string), ['Fact one.', 'Fact two.']);
  assert.equal(selectUnenriched(db, 10).length, 0); // больше не необогащён
  db.close();
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/db/articles.test.ts`
Expected: FAIL — `selectUnenriched`/`writeEnrichment` не существуют.

- [ ] **Step 3: Реализовать репозиторий**

В `src/db/articles.ts` добавить:

```ts
/** Кандидат, ещё не прошедший обогащение (вход T7). */
export interface UnenrichedArticle {
  id: number;
  source: string;
  lang: string | null;
  title: string;
  description: string | null;
}

const SELECT_UNENRICHED = `
  SELECT id, source, lang, title, description
  FROM articles
  WHERE enriched_at IS NULL
  ORDER BY id
  LIMIT @limit`;

/** Необогащённые кандидаты (partial-индекс idx_articles_unenriched), по id, с капом. */
export function selectUnenriched(db: Database.Database, limit: number): UnenrichedArticle[] {
  return db.prepare(SELECT_UNENRICHED).all({ limit }) as UnenrichedArticle[];
}

/** Результат обогащения одной статьи (для записи в articles). */
export interface EnrichmentWrite {
  id: number;
  clusterKey: string;
  entities: string[];
  tags: string[];
  quality: number;
  isUrgent: boolean;
  isMajor: boolean;
  neutralFacts: string[];
  enrichedAt: number; // epoch ms
}

const UPDATE_ENRICHMENT = `
  UPDATE articles SET
    enriched_at   = @enrichedAt,
    cluster_key   = @clusterKey,
    entities      = @entities,
    tags          = @tags,
    quality       = @quality,
    is_urgent     = @isUrgent,
    is_major      = @isMajor,
    neutral_facts = @neutralFacts
  WHERE id = @id`;

/**
 * Пишет результаты обогащения пачкой в одной транзакции. JSON-поля сериализуются,
 * boolean → 0/1 (под CHECK-констрейнты). Возвращает число обновлённых строк.
 */
export function writeEnrichment(
  db: Database.Database,
  rows: EnrichmentWrite[],
): { updated: number } {
  const stmt = db.prepare(UPDATE_ENRICHMENT);
  const run = db.transaction((batch: EnrichmentWrite[]): number => {
    let updated = 0;
    for (const r of batch) {
      updated += stmt.run({
        id: r.id,
        enrichedAt: r.enrichedAt,
        clusterKey: r.clusterKey,
        entities: JSON.stringify(r.entities),
        tags: JSON.stringify(r.tags),
        quality: r.quality,
        isUrgent: r.isUrgent ? 1 : 0,
        isMajor: r.isMajor ? 1 : 0,
        neutralFacts: JSON.stringify(r.neutralFacts),
      }).changes;
    }
    return updated;
  });
  return { updated: run(rows) };
}
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/db/articles.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 7: Конфиг обогащения (env)

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`
- Test: `src/config/index.test.ts` (создать, если ещё нет — иначе добавить тесты)

**Interfaces:**
- Produces: `Config.MAX_ENRICH_BATCH: number`, `Config.ENRICH_RUN_CAP: number`

> Примечание: значения потребляет слой запуска прогона (T15), который передаст их в
> `enrichPending` через `deps`. Сам оркестратор `getConfig` не вызывает (тестируемость).

- [ ] **Step 1: Failing-тест**

В тесте конфига (рядом с существующими тестами `parseConfig`) добавить:

```ts
test('parseConfig: дефолты обогащения', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't' });
  assert.equal(cfg.MAX_ENRICH_BATCH, 20);
  assert.equal(cfg.ENRICH_RUN_CAP, 200);
});

test('parseConfig: переопределение обогащения из env (coerce)', () => {
  const cfg = parseConfig({ TELEGRAM_BOT_TOKEN: 't', MAX_ENRICH_BATCH: '5', ENRICH_RUN_CAP: '50' });
  assert.equal(cfg.MAX_ENRICH_BATCH, 5);
  assert.equal(cfg.ENRICH_RUN_CAP, 50);
});
```

(Импорт `parseConfig` из `./index.js`, `test`/`assert` как в остальных тестах.)

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/config/index.test.ts`
Expected: FAIL — поля отсутствуют (`undefined`).

- [ ] **Step 3: Реализовать**

В `src/config/index.ts` в `EnvSchema` добавить:

```ts
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Обогащение (T7): размер батча на один LLM-вызов и кап кандидатов за прогон.
  MAX_ENRICH_BATCH: z.coerce.number().int().positive().default(20),
  ENRICH_RUN_CAP: z.coerce.number().int().positive().default(200),
```

В `.env.example` добавить:

```
# Обогащение (T7): размер батча на один LLM-вызов и кап кандидатов за прогон
MAX_ENRICH_BATCH=20
ENRICH_RUN_CAP=200
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/config/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts'`
Expected: PASS.

---

### Task 8: Оркестратор обогащения (`src/enrich/index.ts`)

**Files:**
- Create: `src/enrich/index.ts`
- Test: `src/enrich/index.test.ts`

**Interfaces:**
- Consumes: `selectUnenriched`/`writeEnrichment` (Task 6), `buildEnrichPrompt`/`EnrichInput` (Task 5), `makeBatchSchema`/`EnrichItem` (Task 4), `deriveClusterKey` (Task 3), `LLMClient`/`createLLMClient` (`src/llm`), `resolveLlmConfig` (`src/config`).
- Produces:
  - `interface EnrichDeps { now?: () => number; logger?: Logger; maxBatch?: number; runCap?: number }`
  - `interface EnrichResult { selected: number; enriched: number; skipped: number }`
  - `enrichPending(db, llm: LLMClient, deps?: EnrichDeps): Promise<EnrichResult>`
  - `resolveEnrichClient(logger: Logger, env?: Record<string, string | undefined>): Promise<LLMClient>`

- [ ] **Step 1: Failing-тест**

`src/enrich/index.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { insertArticles, selectUnenriched, type ArticleInsert } from '../db/articles.js';
import { createClient } from '../llm/index.js';
import { createFakeAdapter } from '../llm/providers/fake.js';
import type { ProviderResult } from '../llm/types.js';
import type { Logger } from '../log/index.js';
import { enrichPending, resolveEnrichClient } from './index.js';

const silent: Logger = { info() {}, warn() {}, error() {} };

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function art(over: Partial<ArticleInsert> = {}): ArticleInsert {
  return {
    canonicalUrl: 'https://e.com/a',
    source: 'e.com',
    feedSourceId: null,
    lang: 'en',
    title: 'Title',
    publishedAt: null,
    fetchedAt: 1,
    description: 'desc',
    ...over,
  };
}

function okItem(ref: number) {
  return {
    ref,
    entities: ['NATO', 'Ukraine'],
    tags: ['world'],
    quality: 70,
    is_urgent: false,
    is_major: true,
    neutral_facts: ['Fact one.', 'Fact two.'],
  };
}

function result(raw: unknown): ProviderResult {
  return { raw, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-model' };
}

function fakeClient(results: ProviderResult[]) {
  return createClient(createFakeAdapter({ results }), { logger: silent });
}

test('enrichPending: обогащает чанк, пишет поля и cluster_key', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  const id = selectUnenriched(db, 10)[0].id;
  const llm = fakeClient([result([okItem(0)])]);

  const res = await enrichPending(db, llm, { logger: silent, now: () => 9000 });
  assert.deepEqual(res, { selected: 1, enriched: 1, skipped: 0 });

  const r = db
    .prepare(`SELECT enriched_at, cluster_key, quality, is_major FROM articles WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  assert.equal(r.enriched_at, 9000);
  assert.equal(r.cluster_key, 'nato|ukraine');
  assert.equal(r.quality, 70);
  assert.equal(r.is_major, 1);
  db.close();
});

test('enrichPending: битый чанк изолируется (лог+пропуск), статьи остаются необогащёнными', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  // оба ответа невалидны (нет элементов) → LlmSchemaError после ретрая
  const llm = fakeClient([result([]), result([])]);

  const res = await enrichPending(db, llm, { logger: silent });
  assert.deepEqual(res, { selected: 1, enriched: 0, skipped: 1 });
  assert.equal(selectUnenriched(db, 10).length, 1); // не обогащена → дообработается позже
  db.close();
});

test('enrichPending: идемпотентность — повторный прогон ничего не выбирает', async () => {
  const db = memDb();
  insertArticles(db, [art({ canonicalUrl: 'https://e.com/a' })]);
  const llm = fakeClient([result([okItem(0)])]);
  await enrichPending(db, llm, { logger: silent });

  const llm2 = fakeClient([]); // очередь пуста — но и вызовов быть не должно
  const res = await enrichPending(db, llm2, { logger: silent });
  assert.deepEqual(res, { selected: 0, enriched: 0, skipped: 0 });
  db.close();
});

test('enrichPending: бьёт на чанки по maxBatch', async () => {
  const db = memDb();
  insertArticles(db, [
    art({ canonicalUrl: 'https://e.com/a' }),
    art({ canonicalUrl: 'https://e.com/b' }),
    art({ canonicalUrl: 'https://e.com/c' }),
  ]);
  // maxBatch=2 → чанки [a,b] и [c]; refs локальные: [0,1] и [0]
  const llm = fakeClient([result([okItem(0), okItem(1)]), result([okItem(0)])]);
  const res = await enrichPending(db, llm, { logger: silent, maxBatch: 2 });
  assert.deepEqual(res, { selected: 3, enriched: 3, skipped: 0 });
  db.close();
});

test('resolveEnrichClient: fail-fast при отсутствии LLM_PROVIDER', async () => {
  await assert.rejects(() => resolveEnrichClient(silent, {}));
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx tsx --test src/enrich/index.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать оркестратор**

`src/enrich/index.ts`:

```ts
import type Database from 'better-sqlite3';
import { resolveLlmConfig } from '../config/index.js';
import {
  selectUnenriched,
  writeEnrichment,
  type EnrichmentWrite,
} from '../db/articles.js';
import { createLLMClient, type LLMClient } from '../llm/index.js';
import { createLogger, type Logger } from '../log/index.js';
import { deriveClusterKey } from './cluster-key.js';
import { buildEnrichPrompt, type EnrichInput } from './prompt.js';
import { makeBatchSchema, type EnrichItem } from './schema.js';

// Дефолты дублируют config (MAX_ENRICH_BATCH/ENRICH_RUN_CAP): оркестратор не зовёт getConfig
// (тестируемость), слой запуска (T15) передаст значения из конфига через deps.
const DEFAULT_MAX_BATCH = 20;
const DEFAULT_RUN_CAP = 200;
const ENRICH_MAX_OUTPUT_TOKENS = 4096; // батч до ~20 объектов JSON

export interface EnrichDeps {
  now?: () => number;
  logger?: Logger;
  maxBatch?: number;
  runCap?: number;
}

export interface EnrichResult {
  selected: number;
  enriched: number;
  skipped: number;
}

/**
 * Глобальный проход обогащения: новые кандидаты (enriched_at IS NULL) → батч-вызовы LLM →
 * запись полей в articles. Битый чанк изолируется (лог + пропуск, статьи остаются
 * необогащёнными и дообработаются в следующий прогон). Кластеры (T8) не трогаются.
 */
export async function enrichPending(
  db: Database.Database,
  llm: LLMClient,
  deps: EnrichDeps = {},
): Promise<EnrichResult> {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? createLogger('enrich');
  const maxBatch = deps.maxBatch ?? DEFAULT_MAX_BATCH;
  const runCap = deps.runCap ?? DEFAULT_RUN_CAP;

  const pending = selectUnenriched(db, runCap);
  let enriched = 0;
  let skipped = 0;

  for (let i = 0; i < pending.length; i += maxBatch) {
    const chunk = pending.slice(i, i + maxBatch);
    const batch: EnrichInput[] = chunk.map((a, idx) => ({
      ref: idx,
      source: a.source,
      lang: a.lang,
      title: a.title,
      description: a.description,
    }));
    const refs = batch.map((b) => b.ref);
    const { system, input } = buildEnrichPrompt(batch);

    try {
      const res = await llm.generateStructured<EnrichItem[]>({
        system,
        input,
        schema: makeBatchSchema(refs),
        schemaName: 'enrich_batch',
        maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
      });
      const ts = now();
      const writes: EnrichmentWrite[] = res.value.map((item) => {
        const article = chunk[item.ref]!; // ref валидирован схемой: ∈ [0, chunk.length)
        return {
          id: article.id,
          clusterKey: deriveClusterKey(item.entities),
          entities: item.entities,
          tags: item.tags,
          quality: item.quality,
          isUrgent: item.is_urgent,
          isMajor: item.is_major,
          neutralFacts: item.neutral_facts,
          enrichedAt: ts,
        };
      });
      writeEnrichment(db, writes);
      enriched += writes.length;
    } catch (err) {
      skipped += chunk.length;
      logger.warn('enrich chunk skipped', {
        size: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('enrich done', { selected: pending.length, enriched, skipped });
  return { selected: pending.length, enriched, skipped };
}

/**
 * Строит LLM-клиент для прогона обогащения. resolveLlmConfig здесь — реальный fail-fast
 * «нет провайдера/ключа» (follow-up из T6). По умолчанию читает process.env.
 */
export async function resolveEnrichClient(
  logger: Logger,
  env: Record<string, string | undefined> = process.env,
): Promise<LLMClient> {
  const llmConfig = resolveLlmConfig(env);
  return createLLMClient(llmConfig, { logger });
}
```

- [ ] **Step 4: Прогнать — зелёные**

Run: `npx tsx --test src/enrich/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + полный прогон + сборка (без коммита)**

Run: `npm run lint && npx tsx --test 'src/**/*.test.ts' && npm run build`
Expected: PASS — линт чист, все тесты зелёные, TypeScript собирается.

---

## Self-Review (выполнено при написании плана)

**Покрытие спеки:**
- §3 миграция `0002` → Task 1. §4 правка T4 → Task 1. §5 контракт LLM/`makeBatchSchema` → Task 4; промпт → Task 5. §6 `categories.ts` → Task 2; `cluster-key.ts` → Task 3. §7 поток/`enrichPending`/`resolveEnrichClient`/изоляция/fail-fast → Task 8; репозиторий `selectUnenriched`/`writeEnrichment` → Task 6. §8 config → Task 7. §9 тесты → во всех задачах (детерминированные — юнит; оркестрация — fake-провайдер). Пунктов спеки без задачи нет.
- Решение «факты на языке оригинала» закодировано в промпте; «entities/cluster_key язык-независимы» — в промпте + `deriveClusterKey`.
- «Без фактчека» — поля `fake`/credibility в схеме отсутствуют (ничего делать не нужно).

**Плейсхолдеры:** нет TBD/TODO; в каждом шаге, меняющем код, приведён полный код.

**Согласованность типов:** `EnrichItem` (snake_case поля LLM: `is_urgent`/`is_major`/`neutral_facts`) → оркестратор маппит в `EnrichmentWrite` (camelCase: `isUrgent`/`isMajor`/`neutralFacts`) → `writeEnrichment` сериализует/конвертит. `ref` ∈ [0, chunk.length) гарантирован `makeBatchSchema`. `ArticleInsert.description` (Task 1) потребляется `insertArticles` в тестах Task 6/8. `EnrichInput` един для Task 5 и Task 8.
```
