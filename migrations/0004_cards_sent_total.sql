-- Миграция 0004: lifetime-счётчик отправленных карточек для гейта калибровки (T14).
--
-- Калибровка (кнопки 👍/👎 на первых N карточках) раньше читала COUNT(sent_log). С вводом
-- ретенции sent_log чистится, и счёт «оживлял» бы кнопки у малоактивных юзеров. Монотонный
-- счётчик в users от ретенции не зависит.
ALTER TABLE users ADD COLUMN cards_sent_total INTEGER NOT NULL DEFAULT 0;

-- Бэкофилл из текущего sent_log: уже работающая БД не должна откатиться к калибровке.
-- На свежем проде юзеров нет → no-op.
UPDATE users
SET cards_sent_total = (
  SELECT COUNT(*) FROM sent_log WHERE sent_log.chat_id = users.chat_id
);
