-- Гео-фасет: коды стран сюжета (ISO-3166-1 alpha-2, UPPERCASE) или ["GLOBAL"] для безгео.
-- articles.regions заполняет enrich (NULL до обогащения); clusters.regions промотирует представитель.
ALTER TABLE articles ADD COLUMN regions TEXT
  CHECK (regions IS NULL OR json_valid(regions));
ALTER TABLE clusters ADD COLUMN regions TEXT NOT NULL DEFAULT '["GLOBAL"]'
  CHECK (json_valid(regions));
