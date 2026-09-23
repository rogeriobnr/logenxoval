-- Autorização de depósitos por usuário
CREATE TABLE IF NOT EXISTS user_deposits (
  user_id      TEXT NOT NULL REFERENCES users(id),
  deposito_id  TEXT NOT NULL REFERENCES deposits(id),
  concedido_por TEXT NOT NULL,
  concedido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deposito_id)
);
CREATE INDEX IF NOT EXISTS idx_user_deposits_user ON user_deposits (user_id);
CREATE INDEX IF NOT EXISTS idx_user_deposits_deposito ON user_deposits (deposito_id);