-- Simplificação do fluxo de solicitações (compartilhar → enviada → recebida; excluir).
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN
  ('RASCUNHO','ENVIADA','RECEBIDA','EXCLUIDA'));