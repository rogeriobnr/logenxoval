-- LogEnxoval — schema inicial (PostgreSQL)
-- Convenções: ids text (UUID v7 gerados na aplicação), datas ISO-8601 UTC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Identidade
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  matricula     TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  sobrenome     TEXT NOT NULL,
  perfil        TEXT NOT NULL CHECK (perfil IN ('MECANICO', 'LIDER', 'ADMIN')),
  senha_hash    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'BLOQUEADO')),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  device_id       TEXT NOT NULL UNIQUE,
  token_hash      TEXT NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Depósitos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deposits (
  id                   TEXT PRIMARY KEY,
  numero               TEXT NOT NULL UNIQUE,
  nome                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'INATIVO')),
  criado_por           TEXT NOT NULL,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  alterado_por         TEXT,
  alterado_em          TIMESTAMPTZ,
  versao_atual_enxoval TEXT
);

CREATE TABLE IF NOT EXISTS deposit_versions (
  id            TEXT PRIMARY KEY,
  deposito_id   TEXT NOT NULL REFERENCES deposits(id),
  versao        INTEGER NOT NULL,
  data_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id    TEXT NOT NULL,
  matricula     TEXT NOT NULL,
  documento_id  TEXT,
  alteracoes    JSONB,
  motivo        TEXT,
  ref_folha     TEXT,
  hash_documento TEXT,
  status        TEXT NOT NULL DEFAULT 'PUBLICADA'
                CHECK (status IN ('PUBLICADA', 'SUBSTITUIDA', 'RESTAURADA')),
  UNIQUE (deposito_id, versao)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id           TEXT PRIMARY KEY,
  deposito_id  TEXT NOT NULL REFERENCES deposits(id),
  codigo_sap   TEXT NOT NULL,
  material_id  TEXT,
  texto_breve  TEXT NOT NULL,
  foto         TEXT,
  qtd_oficial  INTEGER NOT NULL DEFAULT 0,
  qtd_atual    INTEGER NOT NULL DEFAULT 0,
  utilizacao_livre BOOLEAN NOT NULL DEFAULT false,
  valor_unitario NUMERIC(14,2),
  valor_total   NUMERIC(14,2),
  unidade_medida TEXT,
  estoque_minimo INTEGER,
  status       TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN
               ('ATIVO','INATIVO','REMOVIDO_DA_LISTA_OFICIAL','ALTERADO','PENDENTE_DE_REVISAO')),
  versao       TEXT NOT NULL REFERENCES deposit_versions(id),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_responsavel TEXT NOT NULL,
  UNIQUE (deposito_id, codigo_sap, versao)
);
CREATE INDEX IF NOT EXISTS idx_inventory_deposito ON inventory_items (deposito_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_sap ON inventory_items (codigo_sap, deposito_id);

-- ---------------------------------------------------------------------------
-- Goldbox (baixas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goldbox_movements (
  id              TEXT PRIMARY KEY,
  operation_id    TEXT NOT NULL UNIQUE,
  deposito_id     TEXT NOT NULL REFERENCES deposits(id),
  codigo_sap      TEXT NOT NULL,
  material_id     TEXT,
  descricao       TEXT,
  quantidade      INTEGER NOT NULL,
  data_hora       TIMESTAMPTZ NOT NULL,
  usuario_id      TEXT NOT NULL,
  nome_completo   TEXT NOT NULL,
  matricula       TEXT NOT NULL,
  reposicao       BOOLEAN NOT NULL DEFAULT false,
  origem          TEXT NOT NULL CHECK (origem IN ('ONLINE','OFFLINE')),
  dispositivo     TEXT NOT NULL,
  status_sync     TEXT,
  assinatura_matricula TEXT,
  estorno_de      TEXT REFERENCES goldbox_movements(operation_id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goldbox_deposito_data ON goldbox_movements (deposito_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_goldbox_deposito_sap ON goldbox_movements (deposito_id, codigo_sap);
CREATE INDEX IF NOT EXISTS idx_goldbox_deposito_usuario ON goldbox_movements (deposito_id, matricula);

-- ---------------------------------------------------------------------------
-- Peças avulsas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spare_parts (
  id             TEXT PRIMARY KEY,
  deposito_id    TEXT NOT NULL REFERENCES deposits(id),
  foto           TEXT,
  codigo_sap     TEXT NOT NULL,
  descricao      TEXT NOT NULL,
  quantidade_atual INTEGER NOT NULL DEFAULT 0,
  origem         TEXT NOT NULL CHECK (origem IN
                ('BACKLOG','OUTRA_FRENTE','COMPRA_DEBITO_DIRETO','LIDERANCA','OUTRO')),
  data_entrada   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responsavel    TEXT NOT NULL,
  observacao     TEXT,
  status         TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','INATIVO')),
  UNIQUE (deposito_id, codigo_sap)
);
CREATE INDEX IF NOT EXISTS idx_spare_deposito ON spare_parts (deposito_id);

CREATE TABLE IF NOT EXISTS spare_part_movements (
  id              TEXT PRIMARY KEY,
  deposito_id     TEXT NOT NULL,
  spare_part_id   TEXT NOT NULL REFERENCES spare_parts(id),
  operation_id    TEXT NOT NULL UNIQUE,
  tipo            TEXT NOT NULL CHECK (tipo IN
                 ('ENTRADA','SAIDA','USO_CORRECAO','TRANSFERENCIA_INFORMATIVA',
                  'CONVERSAO_ACEITA','DESCARTE','AJUSTE_AUTORIZADO')),
  quantidade      INTEGER NOT NULL,
  data_hora       TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id      TEXT NOT NULL,
  matricula       TEXT NOT NULL,
  motivo          TEXT,
  estado_anterior JSONB,
  estado_posterior JSONB
);

-- ---------------------------------------------------------------------------
-- Consumíveis e EPIs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consumables (
  id             TEXT PRIMARY KEY,
  deposito_id    TEXT NOT NULL REFERENCES deposits(id),
  foto           TEXT,
  codigo         TEXT NOT NULL,
  descricao      TEXT NOT NULL,
  quantidade     INTEGER NOT NULL DEFAULT 0,
  unidade        TEXT NOT NULL DEFAULT 'unidade',
  estoque_atual  INTEGER NOT NULL DEFAULT 0,
  estoque_minimo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (deposito_id, codigo)
);

CREATE TABLE IF NOT EXISTS consumable_movements (
  id            TEXT PRIMARY KEY,
  consumable_id TEXT NOT NULL REFERENCES consumables(id),
  deposito_id   TEXT NOT NULL,
  operation_id  TEXT NOT NULL UNIQUE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','AJUSTE')),
  quantidade    INTEGER NOT NULL,
  data_hora     TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id    TEXT NOT NULL,
  matricula     TEXT NOT NULL,
  motivo        TEXT
);

CREATE TABLE IF NOT EXISTS ppe_items (
  id             TEXT PRIMARY KEY,
  deposito_id    TEXT NOT NULL REFERENCES deposits(id),
  foto           TEXT,
  codigo         TEXT NOT NULL,
  descricao      TEXT NOT NULL,
  quantidade     INTEGER NOT NULL DEFAULT 0,
  unidade        TEXT NOT NULL DEFAULT 'unidade',
  estoque_atual  INTEGER NOT NULL DEFAULT 0,
  estoque_minimo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (deposito_id, codigo)
);

CREATE TABLE IF NOT EXISTS ppe_movements (
  id            TEXT PRIMARY KEY,
  ppe_item_id   TEXT NOT NULL REFERENCES ppe_items(id),
  deposito_id   TEXT NOT NULL,
  operation_id  TEXT NOT NULL UNIQUE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','AJUSTE')),
  quantidade    INTEGER NOT NULL,
  data_hora     TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id    TEXT NOT NULL,
  matricula     TEXT NOT NULL,
  motivo        TEXT
);

-- Solicitações (consumíveis e EPIs)
CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,
  deposito_id     TEXT NOT NULL REFERENCES deposits(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('CONSUMIVEL','EPI')),
  solicitante_id  TEXT NOT NULL,
  matricula       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN
                 ('RASCUNHO','PRONTA_PARA_ENVIO','ENVIADA','RECEBIDA_PELA_LIDERANCA',
                  'APROVADA','ATENDIDA','CANCELADA')),
  data_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  itens           JSONB NOT NULL DEFAULT '[]'
);

-- ---------------------------------------------------------------------------
-- Conferências
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspections (
  id             TEXT PRIMARY KEY,
  deposito_id    TEXT NOT NULL REFERENCES deposits(id),
  versao_enxoval TEXT NOT NULL REFERENCES deposit_versions(id),
  autor_id       TEXT NOT NULL,
  matricula      TEXT NOT NULL,
  data_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  hora           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'EM_ANDAMENTO'
                 CHECK (status IN ('EM_ANDAMENTO','CONCLUIDA','REVISADA')),
  observacao     TEXT,
  tipo_correcao  TEXT,
  revisao_de     TEXT REFERENCES inspections(id)
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id                TEXT PRIMARY KEY,
  inspection_id     TEXT NOT NULL REFERENCES inspections(id),
  deposito_id       TEXT NOT NULL,
  codigo_sap        TEXT NOT NULL,
  material_id       TEXT,
  qtd_sistema       INTEGER NOT NULL,
  qtd_fisica        INTEGER NOT NULL,
  diferenca         INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('OK','DIVERGENTE','PENDENTE')),
  observacao        TEXT,
  ultima_baixa_goldbox JSONB,
  reposicao_posterior  BOOLEAN NOT NULL DEFAULT false,
  reposicao_pendente   BOOLEAN NOT NULL DEFAULT false,
  corregido         BOOLEAN NOT NULL DEFAULT false,
  correcao_ref      TEXT
);
CREATE INDEX IF NOT EXISTS idx_inspection_items_inspecao ON inspection_items (inspection_id);

-- ---------------------------------------------------------------------------
-- Divergências
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divergences (
  id              TEXT PRIMARY KEY,
  deposito_id     TEXT NOT NULL REFERENCES deposits(id),
  codigo_sap      TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('SALDO_NEGATIVO','CONFERENCIA','REPOSICAO')),
  quantidade      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ABERTA'
                  CHECK (status IN ('ABERTA','EM_ANALISE','RESOLVIDA','CANCELADA')),
  origem_operation_id TEXT,
  inspecao_id     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      TEXT NOT NULL,
  resolvido_em    TIMESTAMPTZ,
  resolvido_por   TEXT
);
CREATE INDEX IF NOT EXISTS idx_divergences_abertas ON divergences (deposito_id, status);

-- ---------------------------------------------------------------------------
-- Sugestões de conversão
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversion_suggestions (
  id                TEXT PRIMARY KEY,
  deposito_id       TEXT NOT NULL REFERENCES deposits(id),
  codigo_sap        TEXT NOT NULL,
  descricao         TEXT NOT NULL,
  qtd_disponivel_pecas INTEGER NOT NULL,
  qtd_prevista_lista   INTEGER NOT NULL,
  qtd_sugerida      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN
                   ('PENDENTE','ACEITA','RECUSADA','CANCELADA','EXPIRADA')),
  motivo            TEXT,
  criado_por        TEXT NOT NULL,
  versao_enxoval    TEXT NOT NULL,
  processada_operation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_sugestoes_status ON conversion_suggestions (deposito_id, status);

-- ---------------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  deposito_id   TEXT NOT NULL REFERENCES deposits(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('FOTO','PDF')),
  nome          TEXT NOT NULL,
  mime          TEXT NOT NULL,
  tamanho       INTEGER NOT NULL,
  hash_documento TEXT NOT NULL,
  bytes         BYTEA,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id    TEXT NOT NULL,
  matricula     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Logs imutáveis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id             TEXT PRIMARY KEY,
  tipo           TEXT NOT NULL,
  data_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id     TEXT NOT NULL,
  matricula      TEXT NOT NULL,
  deposito_id    TEXT,
  entidade       TEXT NOT NULL,
  operacao_id    TEXT,
  estado_anterior JSONB,
  estado_posterior JSONB,
  motivo         TEXT,
  origem         TEXT NOT NULL CHECK (origem IN ('ONLINE','OFFLINE')),
  dispositivo    TEXT NOT NULL,
  hash           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_deposito_data ON audit_logs (deposito_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tipo ON audit_logs (tipo);

-- Imutabilidade: append-only
CREATE OR REPLACE FUNCTION fn_audit_logs_block_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs e imutavel: operacao nao permitida';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_block ON audit_logs;
CREATE TRIGGER trg_audit_logs_block
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_block_write();

-- ---------------------------------------------------------------------------
-- Espelhos / pontos de restauração
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
  id           TEXT PRIMARY KEY,
  deposito_id  TEXT NOT NULL REFERENCES deposits(id),
  titulo       TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('ANTES','DEPOIS')),
  motivo       TEXT,
  usuario_id   TEXT NOT NULL,
  matricula    TEXT NOT NULL,
  data_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id           SERIAL PRIMARY KEY,
  chave        TEXT NOT NULL,
  valor        JSONB,
  deposito_id  TEXT,
  CONSTRAINT settings_chave_deposito_uq UNIQUE (chave, deposito_id)
);

-- ---------------------------------------------------------------------------
-- Idempotência distribuída
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_operations (
  operation_id   TEXT PRIMARY KEY,
  entidade       TEXT NOT NULL,
  acao           TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  processado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resultado      JSONB
);

-- ---------------------------------------------------------------------------
-- RLS: isolamento por depósito
-- ---------------------------------------------------------------------------
ALTER TABLE deposit_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE goldbox_movements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_parts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_part_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables           ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppe_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppe_movements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests              ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE divergences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots             ENABLE ROW LEVEL SECURITY;

-- Política genérica: permite acesso apenas quando app.deposito_id é setado
-- e igual à coluna deposito_id. Usuário admin (app.perfil='ADMIN') pode ler todos.
CREATE OR REPLACE FUNCTION fn_app_context_deposito() RETURNS TEXT AS $$
  SELECT COALESCE(nullif(current_setting('app.deposito_id', true), ''), '');
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deposit_versions','inventory_items','goldbox_movements',
                          'spare_parts','spare_part_movements','consumables',
                          'consumable_movements','ppe_items','ppe_movements','requests',
                          'inspections','inspection_items','divergences',
                          'conversion_suggestions','documents','snapshots']
  LOOP
    EXECUTE format('CREATE POLICY p_all_%I ON %I
      USING (fn_app_context_deposito() = ''__ALL__'' OR deposito_id = fn_app_context_deposito())
      WITH CHECK (deposito_id = fn_app_context_deposito())', t, t);
  END LOOP;
END $$;

-- Sessão de configuração simples, sem alloc de role especial
GRANT USAGE ON SCHEMA public TO PUBLIC;