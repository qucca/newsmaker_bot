# news_bot

Многопользовательский Telegram-бот — персональный новостной куратор. Несколько раз
в день шлёт каждому пользователю подборку новостей под его интересы: карточка с
заголовком, кратким саммари на языке пользователя, ссылкой на оригинал и кнопками 👍/👎.

Архитектура и продуктовые решения — в [docs/design.md](docs/design.md), конвенции
разработки — в [CLAUDE.md](CLAUDE.md).

---

## Локальная разработка

```bash
npm install
cp .env.example .env      # заполнить значения (см. ниже)
npm run migrate           # применить миграции БД
npm run seed:sources      # засидить список источников (идемпотентно)
npm run dev               # запуск в режиме разработки (long polling)
```

Прочие команды: `npm run build`, `npm test`, `npm run lint`, `npm run format`,
`npm start` (прод-запуск из `dist/`).

---

## Деплой (Docker + Compose)

Бот — единый always-on процесс с long polling. Публичный URL/порт **не нужен**.
Состояние (SQLite) живёт в именованном томе и переживает рестарты.

### Требования

- Docker + Docker Compose v2.
- Токен бота от [@BotFather](https://t.me/BotFather).
- API-ключ выбранного LLM-провайдера (Anthropic / OpenAI / Google).

### 1. Конфигурация

```bash
cp .env.example .env
```

Заполнить в `.env` минимум:

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен от @BotFather (обязателен) |
| `LLM_PROVIDER` | `anthropic` \| `openai` \| `google` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | ключ **выбранного** провайдера |

Для `openai`/`google` дополнительно обязателен `LLM_MODEL_DEFAULT`. Остальные
переменные (капы, интервалы, лимиты) имеют разумные дефолты — см. `.env.example`.
`.env` **не коммитим**.

> `DATABASE_PATH` менять не нужно: дефолт `./data/news_bot.sqlite` ложится в том
> `/app/data`.

### 2. Запуск

```bash
docker compose up -d --build
```

При старте контейнер автоматически: применяет миграции → пере-синхронизирует
список источников из репозитория (идемпотентно) → запускает бота (long polling).

### 3. Наблюдение и управление

```bash
docker compose logs -f          # логи
docker compose ps               # статус
docker compose restart          # перезапуск
docker compose down             # остановить (данные в томе сохраняются)
```

### 4. Обновление

```bash
git pull
docker compose up -d --build    # пересборка + рестарт; миграции/сид прогонятся сами
```

### 5. Бэкап и восстановление БД

Данные — в томе `news_bot_data`. Самый простой консистентный бэкап (останов → копия
→ старт), берёт основной файл вместе с WAL:

```bash
docker compose stop bot
docker compose cp bot:/app/data ./backups/data-$(date +%F)
docker compose start bot
```

Восстановление: остановить бота, положить файлы обратно в том (через
`docker compose cp ./backups/<…> bot:/app/data`), запустить.

---

## Заметки

- **Google News (L2) выключен по умолчанию** (`GOOGLE_NEWS_ENABLED=false`, список
  `FEEDS_GN` пуст). L1-фиды (прямые RSS) самодостаточны. Включать осознанно — раскрутка
  завёрнутых URL Google News самая хрупкая зависимость.
- Если LLM не сконфигурирован (нет провайдера/ключа), планировщик не стартует, но бот
  остаётся живым для онбординга и команд — misconfig не валит весь процесс.
- **Алерты в Telegram (опционально):** задай `ADMIN_CHAT_ID` (свой chat id — у @userinfobot), и
  бот пришлёт пинг при запуске, при крахе процесса и при повторных сбоях глобального прохода
  (RSS/LLM лежит). Не задан → только логи. Ретенция БД чистит историю старше `RETENTION_DAYS`
  (дефолт 14) ежедневным maintenance-тиком.
- Секреты никогда не попадают в логи и в образ — прокидываются через `env_file` в рантайме.
