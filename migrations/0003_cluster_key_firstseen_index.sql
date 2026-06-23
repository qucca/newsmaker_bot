-- Миграция 0003: индекс матчинга кластеров под выбранный якорь окна (first_seen).
-- T8 матчит по cluster_key + диапазону first_seen (first_seen >= eventTime - WINDOW),
-- поэтому композит (cluster_key, updated_at) из 0001 не оптимален, а его комментарий
-- «матчинг в окне» больше не отражает запрос. Заменяем 1-в-1 (не добавляем). Запросы
-- только по updated_at по-прежнему покрывает idx_clusters_updated.
DROP INDEX idx_clusters_key_window;
CREATE INDEX idx_clusters_key_firstseen ON clusters (cluster_key, first_seen);
