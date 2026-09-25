-- settings: deposito_id deve aceitar NULL para a linha global (chave ADMIN_PIN_HASH).
-- BDs criados antes desta migração tinham `PRIMARY KEY (chave, deposito_id)`, que
-- deixa deposito_id NOT NULL (implicito de PK) e inviabiliza a linha global com NULL.
-- Para bancos novos (001 corrigido) este bloco é no-op.
DO $$
DECLARE
  _pk TEXT;
BEGIN
  -- derruba a PK legada que inclua deposito_id (liberando o NOT NULL implícito)
  SELECT c.conname INTO _pk
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'deposito_id'
  WHERE c.conrelid = 'settings'::regclass AND c.contype = 'p'
  LIMIT 1;

  IF _pk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE settings DROP CONSTRAINT %I', _pk);
  END IF;

  -- garante uma PK simples em id (bancos legados não têm a coluna)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'settings'::regclass AND contype = 'p') THEN
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS id SERIAL;
    ALTER TABLE settings ADD CONSTRAINT settings_pk_id PRIMARY KEY (id);
  END IF;

  -- unicidade (chave, deposito_id) mantém a integridade mesmo com NULLs liberados
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'settings' AND indexname = 'settings_chave_deposito_uq') THEN
    CREATE UNIQUE INDEX settings_chave_deposito_uq ON settings (chave, deposito_id);
  END IF;
END $$;

-- bancos legados podem ter NOT NULL explícito na coluna — liberar (no-op se já nullable)
ALTER TABLE settings ALTER COLUMN deposito_id DROP NOT NULL;