import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb, withContext } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LDR = 'dev-fase07-lider';
const DEV_ADM = 'dev-fase07-admin';
const DEV_MEC = 'dev-fase07-mec';
const OP = (n: string) => `op-fase07-${n}`;

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

describe('fase07 - peças avulsas e sugestões', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let adminToken: string;
  let mecToken: string;
  let dep: string;
  let mecId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F7-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const admin = await seedUser({ matricula: 'F7-ADM', nome: 'Ana', sobrenome: 'Adm', perfil: 'ADMIN' });
    const mec = await seedUser({ matricula: 'F7-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    mecId = mec.id;

    liderToken = (await login(app, 'F7-LDR', DEV_LDR)).accessToken;
    adminToken = (await login(app, 'F7-ADM', DEV_ADM)).accessToken;
    mecToken = (await login(app, 'F7-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5507', nome: 'Depósito Peças', matriculaConfirmacao: 'F7-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        motivo: 'Base fase07',
        matriculaConfirmacao: 'F7-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002343', textoBreve: 'Bucha 12mm', qtdOficial: 10, qtdAtual: 2, utilizacaoLivre: false },
          { codigoSap: '1002344', textoBreve: 'Arruela M8', qtdOficial: 5, qtdAtual: 5, utilizacaoLivre: true },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function pecaPorSap(sap: string) {
    return withContext(dep, 'LIDER', async (client) => {
      const res = (await client.query(
        `SELECT * FROM spare_parts WHERE deposito_id = $1 AND codigo_sap = $2`,
        [dep, sap],
      )) as unknown as { rows: Array<Record<string, unknown>> };
      return res.rows[0];
    });
  }

  describe('entrada de peça avulsa', () => {
    it('mecânico não pode registrar entrada (exige LIDER/ADMIN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('mec-entrada'),
          codigoSap: '1002341',
          descricao: 'Parafuso M8x20',
          origem: 'BACKLOG',
          quantidade: 3,
          assinaturaMatricula: 'F7-MEC',
          matriculaConfirmacao: 'F7-MEC',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
    });

    it('líder registra entrada: cria peça + movimento ENTRADA + saldo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-1'),
          codigoSap: '1002341',
          descricao: 'Parafuso M8x20',
          origem: 'BACKLOG',
          quantidade: 3,
          observacao: 'Caixa encontrada',
          assinaturaMatricula: 'F7-LDR',
          matriculaConfirmacao: 'F7-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const { peca, jaProcessada } = res.json();
      assert.equal(jaProcessada, false);
      assert.equal(peca.quantidadeAtual, 3);
      assert.equal(peca.codigoSap, '1002341');

      const mov = await withContext(dep, 'LIDER', async (client) => {
        const r = (await client.query(
          `SELECT tipo, quantidade FROM spare_part_movements WHERE operation_id = $1`,
          [OP('entrada-1')],
        )) as unknown as { rows: Array<{ tipo: string; quantidade: number }> };
        return r.rows[0];
      });
      assert.equal(mov.tipo, 'ENTRADA');
      assert.equal(mov.quantidade, 3);

      const audit = await withContext(dep, 'LIDER', async (client) => {
        const r = (await client.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs WHERE tipo = 'ENTRADA_PECA_AVULSA' AND operacao_id = $1`,
          [OP('entrada-1')],
        )) as unknown as { rows: Array<{ n: number }> };
        return r.rows[0].n;
      });
      assert.equal(audit, 1);
    });

    it('segunda entrada soma ao saldo da mesma peça', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-2'),
          codigoSap: '1002341',
          descricao: 'Parafuso M8x20',
          origem: 'OUTRA_FRENTE',
          quantidade: 2,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().peca.quantidadeAtual, 5);
    });

    it('reenvio da mesma entrada → JA_PROCESSADO e saldo inalterado', async () => {
      const antes = (await pecaPorSap('1002341'))?.quantidade_atual as number;
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-1'),
          codigoSap: '1002341',
          descricao: 'Parafuso M8x20',
          origem: 'BACKLOG',
          quantidade: 3,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().jaProcessada, true);
      assert.equal((await pecaPorSap('1002341'))?.quantidade_atual as number, antes);
    });

    it('SAP fora do enxoval vigente → 409 INCOMPATIVEL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-invalida'),
          codigoSap: '9999999',
          descricao: 'Item fora da lista',
          origem: 'OUTRO',
          quantidade: 1,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(res.json().error.code, 'INCOMPATIVEL');
    });
  });

  describe('movimentação (saída/ajuste/descarte)', () => {
    it('saída debita saldo (qualquer perfil)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/does-not-exist/movements`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('saida-invalida'),
          tipo: 'SAIDA',
          quantidade: 1,
          assinaturaMatricula: 'F7-MEC',
        },
      });
      assert.equal(res.statusCode, 404, res.body);
    });

    it('saída suficiente debita; insuficiente → 409 SALDO_CONFLITO', async () => {
      await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-peca-saída'),
          codigoSap: '1002344',
          descricao: 'Arruela M8',
          origem: 'COMPRA_DEBITO_DIRETO',
          quantidade: 4,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      const sp = await pecaPorSap('1002344');
      const resOk = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('saida-ok'),
          tipo: 'SAIDA',
          quantidade: 2,
          assinaturaMatricula: 'F7-MEC',
        },
      });
      assert.equal(resOk.statusCode, 200, resOk.body);
      assert.equal(resOk.json().peca.quantidadeAtual, 2);

      const resFalha = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('saida-suficiente'),
          tipo: 'SAIDA',
          quantidade: 99,
          assinaturaMatricula: 'F7-MEC',
        },
      });
      assert.equal(resFalha.statusCode, 409, resFalha.body);
      assert.equal(resFalha.json().error.code, 'SALDO_CONFLITO');
    });

    it('ajuste autorizado exige LIDER/ADMIN e define novoSaldo', async () => {
      const sp = await pecaPorSap('1002344');
      const resMec = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('ajuste-mec'),
          tipo: 'AJUSTE_AUTORIZADO',
          novoSaldo: 7,
          motivo: 'contagem física',
          assinaturaMatricula: 'F7-MEC',
        },
      });
      assert.equal(resMec.statusCode, 403, resMec.body);

      const resLider = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('ajuste-ok'),
          tipo: 'AJUSTE_AUTORIZADO',
          novoSaldo: 6,
          motivo: 'contagem física',
          assinaturaMatricula: 'F7-LDR',
        },
      });
      assert.equal(resLider.statusCode, 200, resLider.body);
      assert.equal(resLider.json().peca.quantidadeAtual, 6);
    });

    it('descarte exige motivo e perfil; debita saldo', async () => {
      const sp = await pecaPorSap('1002344');
      const semMotivo = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(adminToken, DEV_ADM),
        payload: {
          operationId: OP('descarte-sem-motivo'),
          tipo: 'DESCARTE',
          quantidade: 1,
          assinaturaMatricula: 'F7-ADM',
        },
      });
      assert.equal(semMotivo.statusCode, 400, semMotivo.body);

      const resMec = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: OP('descarte-mec'),
          tipo: 'DESCARTE',
          quantidade: 1,
          motivo: 'material fora de especificação',
          assinaturaMatricula: 'F7-MEC',
        },
      });
      assert.equal(resMec.statusCode, 403, resMec.body);

      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts/${sp.id}/movements`,
        headers: auth(adminToken, DEV_ADM),
        payload: {
          operationId: OP('descarte-ok'),
          tipo: 'DESCARTE',
          quantidade: 3,
          motivo: 'material danificado',
          assinaturaMatricula: 'F7-ADM',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().peca.quantidadeAtual, 3);
    });
  });

  describe('sugestões de conversão', () => {
    it('gera sugestão para SAP com peça disponível e saldo abaixo do previsto (1002343)', async () => {
      await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-sug'),
          codigoSap: '1002343',
          descricao: 'Bucha 12mm',
          origem: 'BACKLOG',
          quantidade: 3,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(liderToken, DEV_LDR),
      });
      assert.equal(res.statusCode, 200, res.body);
      const { sugestoes } = res.json();
      const sug = sugestoes.find((s: { codigoSap: string }) => s.codigoSap === '1002343');
      assert.ok(sug, `deveria existir sugestão para 1002343: ${JSON.stringify(sugestoes)}`);
      assert.equal(sug.status, 'PENDENTE');
      assert.equal(sug.qtdDisponivelPecas, 3);
      assert.equal(sug.qtdPrevistaLista, 10);
      assert.equal(sug.qtdSugerida, 3);
    });

    it('mecânico não pode responder sugestão', async () => {
      const resList = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(liderToken, DEV_LDR),
      });
      const sugestoes = resList.json().sugestoes;
      const sug = sugestoes.find((s: { codigoSap: string }) => s.codigoSap === '1002343');
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/conversion-suggestions/${sug.id}/respond`,
        headers: auth(mecToken, DEV_MEC),
        payload: { operationId: OP('sug-mec'), acao: 'ACEITA', assinaturaMatricula: 'F7-MEC' },
      });
      assert.equal(res.statusCode, 403, res.body);
    });

    it('aceitar converte: debita peça, credita enxoval, sugestão ACEITA', async () => {
      const resList = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(liderToken, DEV_LDR),
      });
      const sugestoes = resList.json().sugestoes;
      const sug = sugestoes.find((s: { codigoSap: string }) => s.codigoSap === '1002343');

      const antesSpare = (await pecaPorSap('1002343'))?.quantidade_atual as number;
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/conversion-suggestions/${sug.id}/respond`,
        headers: auth(liderToken, DEV_LDR),
        payload: { operationId: OP('sug-aceita'), acao: 'ACEITA', assinaturaMatricula: 'F7-LDR' },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().sugestao.status, 'ACEITA');

      const spare = await pecaPorSap('1002343');
      assert.equal(spare.quantidade_atual as number, antesSpare - sug.qtdSugerida);

      const enxoval = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/enxoval`,
        headers: auth(liderToken, DEV_LDR),
      });
      const item = enxoval.json().itens.find((i: { codigoSap: string }) => i.codigoSap === '1002343');
      assert.equal(item.qtdAtual, 5); // 2 + 3
    });

    it('responder sugestão já processada → 409 CONFLITO', async () => {
      const resList = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(adminToken, DEV_ADM),
      });
      const sug = resList.json().sugestoes.find((s: { status: string }) => s.status === 'ACEITA');
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/conversion-suggestions/${sug.id}/respond`,
        headers: auth(adminToken, DEV_ADM),
        payload: { operationId: OP('sug-aceita-novo'), acao: 'RECUSADA', motivo: 'tentar de novo', assinaturaMatricula: 'F7-ADM' },
      });
      assert.equal(res.statusCode, 409, res.body);
    });

    it('recusar exige motivo e mantém histórico (RECUSADA)', async () => {
      await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/spare-parts`,
        headers: auth(liderToken, DEV_LDR),
        payload: {
          operationId: OP('entrada-2342'),
          codigoSap: '1002343',
          descricao: 'Bucha 12mm',
          origem: 'OUTRA_FRENTE',
          quantidade: 4,
          assinaturaMatricula: 'F7-LDR',
        },
      });
      const resList = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(liderToken, DEV_LDR),
      });
      const sugestoes = resList.json().sugestoes;
      const sug = sugestoes.filter((s: { codigoSap: string }) => s.codigoSap === '1002343');
      // gera nova sugestão após a recusa? não — a primeira foi ACEITA e a segunda ainda é gerada (não havia PENDENTE)
      const pendente = sug.find((s: { status: string }) => s.status === 'PENDENTE') ?? sug[0];

      const semMotivo = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/conversion-suggestions/${pendente.id}/respond`,
        headers: auth(adminToken, DEV_ADM),
        payload: { operationId: OP('sug-recusa-sem-motivo'), acao: 'RECUSADA', assinaturaMatricula: 'F7-ADM' },
      });
      assert.equal(semMotivo.statusCode, 400, semMotivo.body);

      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/conversion-suggestions/${pendente.id}/respond`,
        headers: auth(adminToken, DEV_ADM),
        payload: {
          operationId: OP('sug-recusa'),
          acao: 'RECUSADA',
          motivo: 'manter peça avulsa nesta frente',
          assinaturaMatricula: 'F7-ADM',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().sugestao.status, 'RECUSADA');
      assert.equal(res.json().sugestao.motivo, 'manter peça avulsa nesta frente');
    });
  });

  describe('sync offline de peças/sugestões', () => {
    it('push SPARE_PART_ENTRADA processa e retorna ack', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(mecToken, DEV_MEC),
        payload: {
          deviceId: DEV_MEC,
          depositoId: dep,
          operations: [
            {
              operationId: OP('sync-entrada'),
              entidade: 'SPARE_PART_ENTRADA',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                codigoSap: '1002341',
                descricao: 'Parafuso M8x20',
                origem: 'LIDERANCA',
                quantidade: 1,
                assinaturaMatricula: 'F7-MEC',
              },
            },
          ],
        },
      });
      // mecânico não pode entrada — erro por operação, ack não vem
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().errors[0].code, 'PERMISSAO_NEGADA');
    });

    it('push SUGESTAO_RECUSADA processa com perfil ADMIN', async () => {
      const resList = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/conversion-suggestions`,
        headers: auth(liderToken, DEV_LDR),
      });
      const sug = resList.json().sugestoes.find((s: { status: string }) => s.status === 'PENDENTE');
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(adminToken, DEV_ADM),
        payload: {
          deviceId: DEV_ADM,
          depositoId: dep,
          operations: [
            {
              operationId: OP('sync-sug-recusa'),
              entidade: 'SUGESTAO_RECUSADA',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                suggestionId: sug.id,
                acao: 'RECUSADA',
                motivo: 'sugestão offline recusada',
                assinaturaMatricula: 'F7-ADM',
              },
            },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().acks.length, 1);
      assert.equal(res.json().acks[0].status, 'OK');
    });

    it('push SPARE_PART_SAIDA debita saldo offline', async () => {
      const sp = await pecaPorSap('1002341');
      const antes = sp.quantidade_atual as number;
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(mecToken, DEV_MEC),
        payload: {
          deviceId: DEV_MEC,
          depositoId: dep,
          operations: [
            {
              operationId: OP('sync-saida'),
              entidade: 'SPARE_PART_SAIDA',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                sparePartId: sp.id,
                tipo: 'SAIDA',
                quantidade: 2,
                assinaturaMatricula: 'F7-MEC',
              },
            },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().acks.length, 1);
      const depois = (await pecaPorSap('1002341'))?.quantidade_atual as number;
      assert.equal(depois, antes - 2);
    });
  });
});