-- Cadastro público: usuário auto-registrado nasce PENDENTE até aprovação do admin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('ATIVO', 'BLOQUEADO', 'PENDENTE'));