# 14 — Plano de Backup

## 14.1 Servidor (PostgreSQL)

- `pg_dump` diário (full) + WAL contínuo até o último commit.
- Retenção: daily 7d, weekly 4w, monthly 12m.
- Criptografia AES-256 antes de mover para storage out-of-band.
- Teste de restauração automatizado semanal (restore em DB de teste + smoke).
- Verificação de integridade (checksum + contagem de linhas por tabela-chave).

## 14.2 Dispositivo (PWA)

- Export manual `Backup do dispositivo`: JSON completo do IndexedDB (usuários locais, depósito, fila, movimentos não sincronizados, configurações) **criptografado** com chave derivada da senha do usuário (PBKDF2 + AES-GCM).
- O usuário salva o arquivo .lxb (fora do aparelho) e guarda a chave/frase.
- Import: restaura IndexedDB preservando `operationId`s (idempotência mantém consistência com servidor).
- Sugestão de auto-export semanal + lembrete.

## 14.3 Domínio/secretos

- `DATABASE_URL`, `JWT_SECRET`, chave de backup/mestre: no cofre de ambiente da Vercel e nunca no repositório.

## 14.4 Restauração de backup

- Restore do servidor: parar escrita, restaurar dump, validar, religar; registrar `audit_logs` `BACKUP_RESTAURACAO`.
- Restore do device: recria IndexedDB, pede login, na primeira sync o servidor re-ack todos os `operationId`s (idempotência).

## 14.5 Relatório

- Log de execução de backup (quando, tam, sha256) no painel de configurações (admin).