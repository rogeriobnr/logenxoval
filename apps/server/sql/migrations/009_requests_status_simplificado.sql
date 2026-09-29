-- Simplificação do fluxo de solicitações (compartilhar → enviada → recebida; excluir).
--
-- Bancos criados antes da fase 18 podem ter solicitações nos status do fluxo
-- antigo (PRONTA_PARA_ENVIO, RECEBIDA_PELA_LIDERANCA, APROVADA, ATENDIDA,
-- CANCELADA). Sem normalizar antes, o CHECK constraint novo é violado e a
-- migração inteira aborta (deploy quebra). O mapeamento:
--   PRONTA_PARA_ENVIO        -> ENVIADA
--   RECEBIDA_PELA_LIDERANCA  -> RECEBIDA
--   APROVADA / ATENDIDA      -> RECEBIDA
--   CANCELADA                -> EXCLUIDA
-- RASCUNHO e ENVIADA já são válidos no fluxo novo (UPDATE é no-op para eles).
--
-- A ordem importa: o CHECK antigo (001_init) NÃO aceita RECEBIDA nem EXCLUIDA,
-- então ele precisa sair ANTES dos UPDATE, senão o próprio UPDATE é rejeitado
-- ("new row for relation requests violates check constraint").
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

UPDATE requests SET status = 'ENVIADA'  WHERE status IN ('PRONTA_PARA_ENVIO');
UPDATE requests SET status = 'RECEBIDA' WHERE status IN ('RECEBIDA_PELA_LIDERANCA', 'APROVADA', 'ATENDIDA');
UPDATE requests SET status = 'EXCLUIDA' WHERE status IN ('CANCELADA');

ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN
  ('RASCUNHO','ENVIADA','RECEBIDA','EXCLUIDA'));
