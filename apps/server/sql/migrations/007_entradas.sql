-- Fase 16 — Entradas de material (reposição de enxoval) e consumíveis/EPIs.
-- goldbox_movements passa a registrar também ENTRADAS (crédito de saldo).
ALTER TABLE goldbox_movements ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'BAIXA' CHECK (tipo IN ('BAIXA','ENTRADA'));