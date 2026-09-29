import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../src/db/pool';
import { ensureMigrated, resetDb } from './helpers';

/**
 * Regressão do deploy: em produção a migração 009_requests_status_simplificado
 * abortava com "check constraint requests_status_check of relation requests is
 * violated by some row" por causa de solicitações no fluxo antigo (fase 10).
 * Aqui reproduzimos o estado legado e rodamos o arquivo da migração.
 */
describe('migração 009 — status legados de solicitação normalizados', () => {
  const ARQUIVO = '009_requests_status_simplificado.sql';
  const DEP = 'dep-f22-legado';
  const sql = readFileSync(join(process.cwd(), 'sql', 'migrations', ARQUIVO), 'utf8');

  const LEGADOS: Array<[string, string]> = [
    ['req-1', 'PRONTA_PARA_ENVIO'],
    ['req-2', 'RECEBIDA_PELA_LIDERANCA'],
    ['req-3', 'APROVADA'],
    ['req-4', 'ATENDIDA'],
    ['req-5', 'CANCELADA'],
    ['req-6', 'RASCUNHO'],
    ['req-7', 'ENVIADA'],
  ];

  before(async () => {
    await ensureMigrated();
    await resetDb();
    await getPool().query(
      `INSERT INTO deposits (id, numero, nome, criado_por) VALUES ($1, '4902', 'Legado', 'F22')`,
      [DEP],
    );
    // simula o banco que ainda estava no fluxo antigo: com o CHECK do 001_init
    // (que NÃO aceita RECEBIDA/EXCLUIDA) e solicitações nos status legados
    await getPool().query('ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check');
    await getPool().query(`ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN
      ('RASCUNHO','PRONTA_PARA_ENVIO','ENVIADA','RECEBIDA_PELA_LIDERANCA','APROVADA','ATENDIDA','CANCELADA'))`);
    for (const [id, status] of LEGADOS) {
      await getPool().query(
        `INSERT INTO requests (id, deposito_id, tipo, solicitante_id, matricula, status)
         VALUES ($1, $2, 'CONSUMIVEL', 'u1', 'F22', $3)`,
        [id, DEP, status],
      );
    }
  });

  after(async () => {
    await getPool().query('DELETE FROM requests WHERE deposito_id = $1', [DEP]);
    await getPool().query('DELETE FROM deposits WHERE id = $1', [DEP]);
    await closePool();
  });

  it('normaliza os status do fluxo antigo e passa a aplicar o CHECK novo', async () => {
    await getPool().query(sql);

    const { rows } = await getPool().query(
      'SELECT id, status FROM requests WHERE deposito_id = $1 ORDER BY id',
      [DEP],
    );
    const statusPorId = new Map(rows.map((r) => [r.id as string, r.status as string]));

    assert.equal(statusPorId.get('req-1'), 'ENVIADA', 'PRONTA_PARA_ENVIO → ENVIADA');
    assert.equal(statusPorId.get('req-2'), 'RECEBIDA', 'RECEBIDA_PELA_LIDERANCA → RECEBIDA');
    assert.equal(statusPorId.get('req-3'), 'RECEBIDA', 'APROVADA → RECEBIDA');
    assert.equal(statusPorId.get('req-4'), 'RECEBIDA', 'ATENDIDA → RECEBIDA');
    assert.equal(statusPorId.get('req-5'), 'EXCLUIDA', 'CANCELADA → EXCLUIDA');
    assert.equal(statusPorId.get('req-6'), 'RASCUNHO', 'RASCUNHO preservado');
    assert.equal(statusPorId.get('req-7'), 'ENVIADA', 'ENVIADA preservado');

    const legadoRestante = await getPool().query(
      `SELECT count(*)::int AS n FROM requests
       WHERE status NOT IN ('RASCUNHO','ENVIADA','RECEBIDA','EXCLUIDA')`,
    );
    assert.equal(legadoRestante.rows[0].n, 0, 'nenhum status legado sobra');

    await assert.rejects(
      getPool().query(
        `INSERT INTO requests (id, deposito_id, tipo, solicitante_id, matricula, status)
         VALUES ('req-8', $1, 'EPI', 'u1', 'F22', 'APROVADA')`,
        [DEP],
      ),
      /requests_status_check/,
      'CHECK novo rejeita status do fluxo antigo',
    );
  });
});
