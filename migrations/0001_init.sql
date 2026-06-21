-- Миграция 0001: начальная схема MVP.
--
-- Конвенции (см. обсуждение схемы):
--   * Время — INTEGER, Unix epoch в МИЛЛИСЕКУНДАХ, UTC (без строкового ISO: исключаем
--     хрупкость лексикографического сравнения в скользящем окне кластеров).
--   * JSON-поля — TEXT с CHECK(json_valid(...)).
--   * Все таблицы STRICT (жёсткие типы, без affinity-сюрпризов).
--   * PRAGMA (journal_mode=WAL, foreign_keys=ON, busy_timeout) задаются в коде
--     подключения (src/db/connection.ts) — это настройки соединения, не схемы.

-- Пользователи. Теги интересов, свободный профиль и сигналы фидбэка — РАЗДЕЛЬНО.
-- profile_text LLM не переписывает. Поля срочного контура — за пределами MVP (v1.5).
CREATE TABLE users (
  chat_id            INTEGER PRIMARY KEY,                  -- Telegram chat id (ЛС: == user id)
  lang               TEXT    NOT NULL CHECK (lang GLOB '[a-z][a-z]'),  -- язык саммари, ISO 639-1 lowercase
  tz                 TEXT    NOT NULL,                     -- IANA tz ('Europe/Moscow')
  interest_tags      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(interest_tags)),
  profile_text       TEXT    NOT NULL DEFAULT '',          -- свободный текст, не переписывается
  reading_windows    TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(reading_windows)),
  max_items_per_send INTEGER NOT NULL CHECK (max_items_per_send > 0),
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),  -- 0 при 403
  last_sent_at       INTEGER,                              -- для расписания (epoch ms)
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
) STRICT;

-- Реестр фидов (что фетчить). MVP: только L1 (kind='l1_rss'). GN-специфику (hl/gl/ceid,
-- шаблон запроса) добавит T16; набор kind заранее включает будущие значения.
CREATE TABLE sources (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL DEFAULT 'l1_rss'
                    CHECK (kind IN ('l1_rss', 'gnews_topic', 'gnews_search')),
  name            TEXT    NOT NULL,
  url             TEXT    NOT NULL UNIQUE,                 -- URL фида
  lang            TEXT    NOT NULL,
  categories      TEXT    NOT NULL DEFAULT '[]'            -- категории интересов (JSON-массив, маршрутизация)
                    CHECK (json_valid(categories)),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  etag            TEXT,                                    -- conditional GET (пишет T4)
  last_modified   TEXT,                                    -- conditional GET, HTTP-date (пишет T4)
  last_fetched_at INTEGER
) STRICT;

-- Кластеры («истории»). Ключ = нормализованный набор топ-сущностей.
-- Матчинг по ключу — ТОЛЬКО в скользящем окне ~48-72ч (по updated_at). НЕ UNIQUE по ключу:
-- тот же ключ за окном = новый кластер. Обогащение «промотировано» от представителя.
-- source_count НЕ храним — выводим на лету COUNT(DISTINCT source) (защита от дрейфа).
-- rep_article_id — без FK на articles (сознательно снят цикл articles<->clusters).
CREATE TABLE clusters (
  id             INTEGER PRIMARY KEY,
  cluster_key    TEXT    NOT NULL,                         -- язык-независимый ключ матчинга
  tags           TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),       -- для ранжирования
  entities       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(entities)),
  neutral_facts  TEXT    CHECK (neutral_facts IS NULL OR json_valid(neutral_facts)),  -- вход рендера
  content_hash   TEXT,                                     -- хеш neutral_facts; инвалидация summaries
  quality        INTEGER CHECK (quality IS NULL OR (quality BETWEEN 0 AND 100)),
  is_urgent      INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0, 1)),       -- считается, рассылки нет
  is_major       INTEGER NOT NULL DEFAULT 0 CHECK (is_major IN (0, 1)),        -- крупное событие
  rep_article_id INTEGER,                                  -- представитель для ссылки (без FK)
  first_seen     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_clusters_key_window ON clusters (cluster_key, updated_at);  -- матчинг в окне
CREATE INDEX idx_clusters_updated ON clusters (updated_at);                  -- свежесть/ретенция

-- Кандидаты после резолва. canonical_url UNIQUE = дедуп кандидатов внутри прогона.
-- Обогащение (T7) заполняет enriched_at + поля ниже; cluster_id проставляет T8.
CREATE TABLE articles (
  id             INTEGER PRIMARY KEY,
  canonical_url  TEXT    NOT NULL UNIQUE,                  -- основа дедупа кандидатов
  source         TEXT    NOT NULL,                         -- издание (домен/паблишер)
  feed_source_id INTEGER REFERENCES sources (id) ON DELETE SET NULL,  -- из какого фида (провенанс)
  lang           TEXT,                                     -- язык оригинала
  title          TEXT    NOT NULL,                         -- исходный заголовок
  published_at   INTEGER,                                  -- из фида (epoch ms)
  fetched_at     INTEGER NOT NULL,
  cluster_id     INTEGER REFERENCES clusters (id) ON DELETE SET NULL,  -- NULL до кластеризации
  -- выход глобального обогащения (NULL до T7):
  enriched_at    INTEGER,                                  -- NULL = ещё не обогащён
  cluster_key    TEXT,                                     -- нормализованный ключ
  entities       TEXT    CHECK (entities IS NULL OR json_valid(entities)),
  tags           TEXT    CHECK (tags IS NULL OR json_valid(tags)),
  quality        INTEGER CHECK (quality IS NULL OR (quality BETWEEN 0 AND 100)),
  is_urgent      INTEGER CHECK (is_urgent IS NULL OR is_urgent IN (0, 1)),
  is_major       INTEGER CHECK (is_major IS NULL OR is_major IN (0, 1)),
  neutral_facts  TEXT    CHECK (neutral_facts IS NULL OR json_valid(neutral_facts))
) STRICT;
CREATE INDEX idx_articles_cluster ON articles (cluster_id);
CREATE INDEX idx_articles_unenriched ON articles (id) WHERE enriched_at IS NULL;  -- partial
CREATE INDEX idx_articles_unclustered ON articles (id) WHERE cluster_id IS NULL;  -- partial

-- Кеш саммари. Ключ (cluster_id, lang) — одна строка на язык, переиспользуется всеми.
-- content_hash = срез фактов, из которого отрендерено (сверяется с clusters.content_hash).
CREATE TABLE summaries (
  cluster_id   INTEGER NOT NULL REFERENCES clusters (id) ON DELETE CASCADE,
  lang         TEXT    NOT NULL CHECK (lang GLOB '[a-z][a-z]'),
  title        TEXT    NOT NULL,                           -- заголовок на языке lang
  summary      TEXT    NOT NULL,                           -- нейтральное саммари на языке lang
  content_hash TEXT    NOT NULL,                           -- из какого среза фактов отрендерено
  model        TEXT,                                       -- какая модель рендерила
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (cluster_id, lang)
) STRICT, WITHOUT ROWID;

-- Фидбэк как структурированные сигналы. source НЕ NULL и денормализован — основа свёртки
-- (MVP-штраф по изданию). cluster_id -> SET NULL при чистке кластера (голос/издание сохраняем).
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY,
  chat_id    INTEGER NOT NULL REFERENCES users (chat_id) ON DELETE CASCADE,
  cluster_id INTEGER REFERENCES clusters (id) ON DELETE SET NULL,
  vote       INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  source     TEXT    NOT NULL,                             -- издание (для свёртки)
  created_at INTEGER NOT NULL,
  UNIQUE (chat_id, cluster_id)                             -- один голос на (юзер, кластер), переголос
) STRICT;
CREATE INDEX idx_feedback_user_source ON feedback (chat_id, source);

-- Блок-лист изданий по юзеру.
CREATE TABLE blocked_sources (
  chat_id    INTEGER NOT NULL REFERENCES users (chat_id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, source)
) STRICT, WITHOUT ROWID;

-- Что отправлено. Ключ (chat_id, cluster_id) = дедуп ПО КЛАСТЕРУ (не по URL).
-- Пишется сразу после ack Telegram (идемпотентность). Ретенция — задачей приложения.
CREATE TABLE sent_log (
  chat_id    INTEGER NOT NULL REFERENCES users (chat_id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL REFERENCES clusters (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL DEFAULT 'digest' CHECK (kind IN ('digest', 'urgent')),
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (chat_id, cluster_id)
) STRICT, WITHOUT ROWID;
