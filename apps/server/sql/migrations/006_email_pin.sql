-- Fase 14: e-mail e PIN por usuário
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_uq') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_uq UNIQUE (email);
  END IF;
END $$;

-- Tokens de recuperação de senha (uso único, expiram em 30 min)
CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expira_em  TIMESTAMPTZ NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  usado_em   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash);