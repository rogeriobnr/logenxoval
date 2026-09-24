-- Fase 06 — Conferência física
-- Devolução de peça avulsa usada em correção (estorno de correção, docs 5.7).
ALTER TABLE spare_part_movements DROP CONSTRAINT spare_part_movements_tipo_check;
ALTER TABLE spare_part_movements ADD CONSTRAINT spare_part_movements_tipo_check
  CHECK (tipo IN ('ENTRADA','SAIDA','USO_CORRECAO','TRANSFERENCIA_INFORMATIVA',
                  'CONVERSAO_ACEITA','DESCARTE','AJUSTE_AUTORIZADO','DEVOLUCAO_CORRECAO'));