#!/bin/sh
set -e

# Подготовка БД перед стартом. Обе команды идемпотентны и не требуют секретов
# (только DATABASE_PATH) — можно гонять на каждый рестарт контейнера.

echo "[entrypoint] applying migrations..."
node dist/db/migrate.js

# Источники версионируются в коде (FEEDS_L1) и применяются идемпотентным upsert
# (design.md). Пере-синхронизирует список фидов из репозитория при каждом деплое.
echo "[entrypoint] seeding sources..."
node dist/sources/seed.js

echo "[entrypoint] starting: $*"
exec "$@"
