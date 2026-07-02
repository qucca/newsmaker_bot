-- Типизированная цель дизлайка. reason_type NULL = лайк или легаси-строка.
-- reason_key: пара "tag|CC", тег "tag", регион "CC", источник "<source>".
ALTER TABLE feedback ADD COLUMN reason_type TEXT
  CHECK (reason_type IS NULL OR reason_type IN ('pair', 'tag', 'region', 'source'));
ALTER TABLE feedback ADD COLUMN reason_key TEXT;
CREATE INDEX idx_feedback_reason ON feedback (chat_id, reason_type, reason_key);
