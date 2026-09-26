-- Fase 17: conferência identifica pendência de baixa e baixa com marcação
-- "é reposição" entra na lista de aguardando reposição (docs 17).
ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS qtd_oficial INTEGER;
ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS pendencia_baixa BOOLEAN NOT NULL DEFAULT false;