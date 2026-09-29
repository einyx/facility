-- Operator plugins add agent engines beyond claude_code and codex. Constrain the
-- name's shape instead of enumerating engines; the manifest schema uses the same pattern.
ALTER TABLE turns DROP CONSTRAINT IF EXISTS turns_engine_check;
ALTER TABLE turns
  ADD CONSTRAINT turns_engine_check CHECK (engine ~ '^[a-z][a-z0-9_]{0,63}$');

ALTER TABLE engine_sessions DROP CONSTRAINT IF EXISTS engine_sessions_engine_check;
ALTER TABLE engine_sessions
  ADD CONSTRAINT engine_sessions_engine_check CHECK (engine ~ '^[a-z][a-z0-9_]{0,63}$');
