# Многоступенчатая сборка. better-sqlite3 — нативный модуль: тулчейн нужен только
# на этапе сборки, в финальный образ не попадает. Обе стадии на одном базовом образе
# (node:24-bookworm-slim) — скомпилированный .node-бинарь совместим по glibc/arch.

# ---- builder: ставит все зависимости, компилирует TS в dist/, чистит dev-deps ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Тулчейн для сборки better-sqlite3, если нет готового prebuild под Node 24.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Слой зависимостей кешируется отдельно от исходников.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Выкидываем dev-зависимости (tsc/tsx/eslint/…); скомпилированный better-sqlite3 остаётся.
RUN npm prune --omit=dev

# ---- runtime: только прод-зависимости, dist, миграции и entrypoint ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
# migrate.js резолвит каталог относительно файла: dist/db/migrate.js → /app/migrations.
COPY migrations ./migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Каталог под БД (точка монтирования тома) и непривилегированный пользователь.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/data \
  && chown -R node:node /app
USER node

# Long polling: портов наружу нет, публичный URL не нужен.
# Entrypoint прогоняет миграции + сид источников, затем запускает CMD.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
