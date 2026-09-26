import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb, withContext } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';
import { newId } from '../src/lib/crypto';

const DEV_LDR = 'dev-fase06-lider';
const DEV_MEC = 'dev-fase06-mec';
const OP = (n: string) => `op-fase06-${n}`;

async function seedUser(opts: { matricula: string; nome: string; sobrenome: string; perfil: 'MECANICO' | 'LIDER' | 'ADMIN' }) {
  const senhaHash = await bcrypt.hash('senha-teste-123', 4);
  return createUser({ ...opts, senhaHash });
}

function auth(token: string, device: string) {
  return { authorization: `Bearer ${token}`, 'x-device-id': device };
}

async function login(app: FastifyInstance, matricula: string, device: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-id': device },
    payload: { matricula, senha: 'senha-teste-123', deviceId: device },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

function conferenciaPayload(over: Record<string, unknown> = {}) {
  return {
    hora: '09:30',
    assinaturaMatricula: 'F6-LDR',
    matriculaConfirmacao: 'F6-LDR',
    itens: [
      { codigoSap: '1002341', qtdFisica: 8 }, // sistema 10 → -2
      { codigoSap: '1002342', qtdFisica: 3 }, // sistema 1 → +2
    ],
    ...over,
  };
}

describe('fase06 - conferência física', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;
  let inspecaoId: string;
  let item121Id: string; // 1002341 (divergente -2)
  let item122Id: string; // 1002342 (divergente +2)

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F6-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F6-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F6-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F6-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5506', nome: 'Depósito Conferência', matriculaConfirmacao: 'F6-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        motivo: 'Base fase06',
        matriculaConfirmacao: 'F6-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function spareIdPorSap(sap: string) {
    return withContext(dep, 'MECANICO', async (client) => {
      const res = await client.query(
        `SELECT id FROM spare_parts WHERE deposito_id = $1 AND codigo_sap = $2 ORDER BY data_entrada`,
        [dep, sap],
      ) as unknown as { rows: Array<{ id: string }> };
      return res.rows[0].id;
    });
  }

  async function insertSpare(sap: string, descricao: string, quantidade: number) {
    await withContext(dep, 'MECANICO', async (client) => {
      await client.query(
        `INSERT INTO spare_parts (id, deposito_id, codigo_sap, descricao, quantidade_atual, origem, responsavel, status)
         VALUES ($1,$2,$3,$4,$5,'BACKLOG','F6-LDR','ATIVO')`,
        [newId(), dep, sap, descricao, quantidade],
      );
    });
  }

  describe('criar conferência', () => {
    it('registra conferência EM_ANDAMENTO com itens DIVERGENTES e diferenca correta', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LDR),
        payload: conferenciaPayload(),
      });
      assert.equal(res.statusCode, 200, res.body);
      const { inspecao, itens } = res.json();
      inspecaoId = inspecao.id;
      assert.equal(inspecao.status, 'EM_ANDAMENTO');
      assert.equal(itens.length, 2);
      const d1 = itens.find((i: { codigoSap: string }) => i.codigoSap === '1002341');
      const d2 = itens.find((i: { codigoSap: string }) => i.codigoSap === '1002342');
      assert.equal(d1.status, 'DIVERGENTE');
      assert.equal(d1.diferenca, -2);
      assert.equal(d1.qtdSistema, 10);
      assert.equal(d1.qtdOficial, 10);
      assert.equal(d1.pendenciaBaixa, true); // físico 8 < sistema 10
      assert.equal(d2.status, 'DIVERGENTE');
      assert.equal(d2.diferenca, 2);
      assert.equal(d2.qtdOficial, 1);
      assert.equal(d2.pendenciaBaixa, false); // físico 3 > sistema 1
      item121Id = d1.id;
      item122Id = d2.id;
    });

    it('matrícula de confirmação incorreta → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LDR),
        payload: conferenciaPayload({ matriculaConfirmacao: 'OUTRA' }),
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'MATRICULA_INVALIDA');
    });

    it('item inexistente no enxoval → qtdSistema 0 e DIVERGENTE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LDR),
        payload: conferenciaPayload({ itens: [{ codigoSap: '9999999', qtdFisica: 3 }] }),
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().itens[0].qtdSistema, 0);
      assert.equal(res.json().itens[0].status, 'DIVERGENTE');
    });
  });

  describe('listagem e detalhe', () => {
    it('lista conferências com totais', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LDR),
      });
      assert.equal(res.statusCode, 200);
      const first = res.json().conferencias[0];
      assert.ok((first.totalItens as number) >= 1);
    });

    it('detalhe expõe peça avulsa disponível do mesmo SAP', async () => {
      await insertSpare('1002341', 'Parafuso reserva', 4);
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/inspections/${inspecaoId}`,
        headers: auth(liderToken, DEV_LDR),
      });
      assert.equal(res.statusCode, 200, res.body);
      const divergente = res.json().itens.find((i: { id: string }) => i.id === item121Id);
      assert.equal(divergente.sparePartDisponivel, 4);
    });
  });

  describe('correção', () => {
    it('ACAO_LIDERANCA: mecânico negado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr-mec-aca'),
          tipo: 'ACAO_LIDERANCA',
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 403);
    });

    it('peça avulsa de SAP diferente → 409 INCOMPATIVEL', async () => {
      await insertSpare('9999999', 'Outra coisa', 5);
      const spareId = await spareIdPorSap('9999999');
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr-incomp'),
          tipo: 'CORRIGIR_COM_PECA_AVULSA',
          sparePartId: spareId,
          quantidade: 1,
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().error.code, 'INCOMPATIVEL');
    });

    it('peça avulsa sem quantidade → 409 ITEM_INDISPONIVEL', async () => {
      const spareId = await spareIdPorSap('1002341'); // 4 disponíveis
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr-falta'),
          tipo: 'CORRIGIR_COM_PECA_AVULSA',
          sparePartId: spareId,
          quantidade: 5,
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().error.code, 'ITEM_INDISPONIVEL');
    });

    it('AGUARDAR_REPOSICAO gera divergência REPOSICAO ABERTA', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr-aguard'),
          tipo: 'AGUARDAR_REPOSICAO',
          observacao: 'Pedir reposição ao almoxarifado',
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const pool = getPool();
      const div = await pool.query(
        "SELECT COUNT(*)::int AS n FROM divergences WHERE deposito_id = $1 AND tipo = 'REPOSICAO' AND status = 'ABERTA'",
        [dep],
      ) as unknown as { rows: Array<{ n: number }> };
      assert.equal(div.rows[0].n, 1);
    });

    it('mecânico corrige com peça avulsa → enxoval credita, peça debita, corregido=true', async () => {
      const spareId = await spareIdPorSap('1002341');
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr1'),
          tipo: 'CORRIGIR_COM_PECA_AVULSA',
          sparePartId: spareId,
          quantidade: 2,
          observacao: 'Corrige com peça avulsa do cofre',
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const { item, saldo } = res.json();
      assert.equal(item.corregido, true);
      assert.equal(item.correcaoRef, OP('corr1'));
      assert.equal(saldo, 12); // 10 + 2
      const pool = getPool();
      const sp = await pool.query(
        'SELECT quantidade_atual FROM spare_parts WHERE id = $1',
        [spareId],
      ) as unknown as { rows: Array<{ quantidade_atual: number }> };
      assert.equal(Number(sp.rows[0].quantidade_atual), 2);
      const mov = await pool.query(
        "SELECT COUNT(*)::int AS n FROM spare_part_movements WHERE operation_id = $1 AND tipo = 'USO_CORRECAO'",
        [OP('corr1')],
      ) as unknown as { rows: Array<{ n: number }> };
      assert.equal(mov.rows[0].n, 1);
    });

    it('reenvio da mesma correção → 200 idempotente, sem duplicar', async () => {
      const spareId = await spareIdPorSap('1002341');
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('corr1'),
          tipo: 'CORRIGIR_COM_PECA_AVULSA',
          sparePartId: spareId,
          quantidade: 2,
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const pool = getPool();
      const mov = await pool.query(
        'SELECT COUNT(*)::int AS n FROM spare_part_movements WHERE operation_id = $1',
        [OP('corr1')],
      ) as unknown as { rows: Array<{ n: number }> };
      assert.equal(mov.rows[0].n, 1);
    });

    it('ACAO_LIDERANCA: líder ajusta saldo ao físico', async () => {
      // item 1002342: sistema 1, físico 3 → delta +2, saldo 1+2=3
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item122Id}/correction`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('corr5'),
          tipo: 'ACAO_LIDERANCA',
          observacao: 'Ajuste liderança',
          assinaturaMatricula: 'F6-LDR',
          matriculaConfirmacao: 'F6-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().saldo, 3);
      assert.equal(res.json().item.corregido, true);
    });
  });

  describe('estorno de correção', () => {
    it('mecânico não pode estornar (requer ESTORNO)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/revert-correction`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('rev-mec'),
          motivo: 'Estorno de correção',
          assinaturaMatricula: 'F6-MEC',
          matriculaConfirmacao: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 403);
    });

    it('líder estorna: devolve peça avulsa e debita enxoval', async () => {
      const spareId = await spareIdPorSap('1002341');
      const antes = await withContext(dep, 'LIDER', async (client) => {
        const res = await client.query('SELECT quantidade_atual FROM spare_parts WHERE id = $1', [spareId]);
        return Number((res as unknown as { rows: Array<{ quantidade_atual: number }> }).rows[0].quantidade_atual);
      });
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/items/${item121Id}/revert-correction`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('rev2'),
          motivo: 'Estorno da correção com peça avulsa',
          assinaturaMatricula: 'F6-LDR',
          matriculaConfirmacao: 'F6-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const depois = await withContext(dep, 'LIDER', async (client) => {
        const res = await client.query('SELECT quantidade_atual FROM spare_parts WHERE id = $1', [spareId]);
        return Number((res as unknown as { rows: Array<{ quantidade_atual: number }> }).rows[0].quantidade_atual);
      });
      assert.equal(depois, antes + 2);
      const item = res.json().itens.find((i: { id: string }) => i.id === item121Id);
      assert.equal(item.corregido, false);
      assert.ok(!item.correcaoRef);
      const pool = getPool();
      const mov = await pool.query(
        "SELECT COUNT(*)::int AS n FROM spare_part_movements WHERE operation_id = $1 AND tipo = 'DEVOLUCAO_CORRECAO'",
        [OP('rev2')],
      ) as unknown as { rows: Array<{ n: number }> };
      assert.equal(mov.rows[0].n, 1);
    });
  });

  describe('finalizar e revisar', () => {
    it('finalizar cria divergência CONFERENCIA para cada item divergente (2)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/finalize`,
        headers: auth(liderToken, DEV_LDR),
        payload: { assinaturaMatricula: 'F6-LDR', matriculaConfirmacao: 'F6-LDR' },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().inspecao.status, 'CONCLUIDA');
      const pool = getPool();
      const div = await pool.query(
        "SELECT COUNT(*)::int AS n FROM divergences WHERE inspecao_id = $1 AND tipo = 'CONFERENCIA'",
        [inspecaoId],
      ) as unknown as { rows: Array<{ n: number }> };
      assert.equal(div.rows[0].n, 2);
    });

    it('finalizar conferência já finalizada → 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/finalize`,
        headers: auth(liderToken, DEV_LDR),
        payload: { assinaturaMatricula: 'F6-LDR', matriculaConfirmacao: 'F6-LDR' },
      });
      assert.equal(res.statusCode, 409);
    });

    it('criar revisão: nova inspeção vira REVISADA e referencia a original (preservada)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections/${inspecaoId}/revision`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          hora: '10:00',
          assinaturaMatricula: 'F6-LDR',
          matriculaConfirmacao: 'F6-LDR',
          itens: [
            { codigoSap: '1002341', qtdFisica: 8 },
            { codigoSap: '1002342', qtdFisica: 3 },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const novaId = res.json().inspecao.id;
      assert.equal(res.json().inspecao.status, 'REVISADA');
      assert.equal(res.json().inspecao.revisaoDe, inspecaoId);
      const pool = getPool();
      const insp = await pool.query('SELECT status FROM inspections WHERE id = $1', [inspecaoId]);
      // a anterior é preservada (docs 5.8)
      assert.equal((insp as unknown as { rows: Array<{ status: string }> }).rows[0].status, 'CONCLUIDA');
      const nova = await pool.query('SELECT revisao_de FROM inspections WHERE id = $1', [novaId]);
      assert.equal((nova as unknown as { rows: Array<{ revisao_de: string }> }).rows[0].revisao_de, inspecaoId);
    });
  });

  describe('auditoria', () => {
    it('registra CONFERENCIA, CORRECAO e ESTORNO', async () => {
      const pool = getPool();
      const res = await pool.query(
        "SELECT tipo, COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo IN ('CONFERENCIA','CORRECAO','ESTORNO') GROUP BY tipo",
        [dep],
      ) as unknown as { rows: Array<{ tipo: string; n: number }> };
      const porTipo = Object.fromEntries(res.rows.map((r) => [r.tipo, r.n]));
      assert.ok((porTipo.CONFERENCIA ?? 0) >= 2);
      assert.ok((porTipo.CORRECAO ?? 0) >= 3); // AGUARDAR + peça avulsa + ACAO
      assert.equal(porTipo.ESTORNO, 1);
    });
  });

  describe('acesso', () => {
    it('usuário sem acesso ao depósito → 403 na conferência', async () => {
      const outro = await seedUser({ matricula: 'F6-OUT', nome: 'Fulano', sobrenome: 'SemAcesso', perfil: 'MECANICO' });
      void outro;
      const tok = (await login(app, 'F6-OUT', 'dev-fase06-outro')).accessToken;
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/inspections`,
        headers: auth(tok, 'dev-fase06-outro'),
      });
      assert.equal(res.statusCode, 403);
    });
  });
});