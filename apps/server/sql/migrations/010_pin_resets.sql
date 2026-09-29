-- Fase 22: recuperação de PIN por e-mail (o mesmo desenho da recuperação de senha).
-- Sem isso, quem esquecesse o próprio PIN ficava travado: redefinir PIN de
-- terceiros e as ações sensíveis exigem o PIN do usuário logado.
CREATE TABLE IF NOT EXISTS pin_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expira_em  TIMESTAMPTZ NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  usado_em   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pin_resets_token ON pin_resets (token_hash);
CREATE INDEX IF NOT EXISTS idx_pin_resets_user ON pin_resets (user_id);
