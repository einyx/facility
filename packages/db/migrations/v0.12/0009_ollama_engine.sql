ALTER TABLE turns DROP CONSTRAINT turns_engine_check;
ALTER TABLE turns
  ADD CONSTRAINT turns_engine_check CHECK (engine IN ('claude_code', 'codex', 'ollama'));

ALTER TABLE engine_sessions DROP CONSTRAINT engine_sessions_engine_check;
ALTER TABLE engine_sessions
  ADD CONSTRAINT engine_sessions_engine_check CHECK (engine IN ('claude_code', 'codex', 'ollama'));
