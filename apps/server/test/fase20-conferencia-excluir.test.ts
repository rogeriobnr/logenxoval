import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LIDER = 'dev-fase20-lider';
const DEV_MEC = 'dev-fase20-mec';
const DEV_OUT = 'dev-fase20-outro';

async function seedUser(opts: {
  matricula: string;
  nome: string;
  sobrenome: string;
  perfil: 'MECANICO' | 'LIDER' | 'ADMIN';
}) {
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

describe('fase20 - conferência conclui na hora + exclusão de consumível/EPI', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let outroToken: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F20-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F20-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    await seedUser({ matricula: 'F20-OUT', nome: 'Oscar', sobrenome: 'Fora', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F20-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F20-MEC', DEV_MEC)).accessToken;
    outroToken = (await login(app, 'F20-OUT', DEV_OUT)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4802', nome: 'Conferência simplificada', matriculaConfirmacao: 'F20-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        motivo: 'Base fase20',
        matriculaConfirmacao: 'F20-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 20, qtdAtual: 20, utilizacaoLivre: false, unidadeMedida: 'pç' },
          { codigoSap: '1002343', textoBreve: 'Arruela M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function registrar(itens: Array<{ codigoSap: string; qtdFisica: number }>, concluir: boolean) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/inspections`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        hora: '10:30',
        itens,
        assinaturaMatricula: 'F20-LDR',
        matriculaConfirmacao: 'F20-LDR',
        ...(concluir ? { concluir: true } : {}),
      },
    });
  }

  async function divergencias(status?: string, tipo?: string) {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (tipo) qs.set('tipo', tipo);
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/divergences${qs.size ? `?${qs}` : ''}`,
      headers: auth(liderToken, DEV_LIDER),
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().divergencias as Array<{ codigoSap: string; tipo: string; quantidade: number; status: string }>;
  }

  describe('conferência com concluir', () => {
    it('registrar com concluir:true nasce CONCLUIDA e abre REPOSICAO para falta e CONFERENCIA para sobra', async () => {
      const res = await registrar(
        [
          { codigoSap: '1002341', qtdFisica: 7 },  // falta 3
          { codigoSap: '1002342', qtdFisica: 25 }, // sobra 5
          { codigoSap: '1002343', qtdFisica: 1 },  // ok
        ],
        true,
      );
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.inspecao.status, 'CONCLUIDA');
      assert.deepEqual(body.divergencias, { reposicao: 1, conferencia: 1 });

      const abertas = await divergencias('ABERTA');
      const rep = abertas.find((d) => d.codigoSap === '1002341' && d.tipo === 'REPOSICAO');
      assert.ok(rep);
      assert.equal(rep.quantidade, 3);
      assert.equal(rep.status, 'ABERTA');
      const conf = abertas.find((d) => d.codigoSap === '1002342' && d.tipo === 'CONFERENCIA');
      assert.ok(conf);
      assert.equal(conf.quantidade, 5);
      assert.ok(!abertas.some((d) => d.codigoSap === '1002343'));
    });

    it('não cria REPOSICAO duplicada quando a pendência já está ABERTA (idempotente)', async () => {
      const res = await registrar([{ codigoSap: '1002341', qtdFisica: 7 }], true);
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json().divergencias, { reposicao: 0, conferencia: 0 });

      const abertas = await divergencias('ABERTA', 'REPOSICAO');
      const reps = abertas.filter((d) => d.codigoSap === '1002341' && d.tipo === 'REPOSICAO');
      assert.equal(reps.length, 1);
    });

    it('conferência sem concluir continua EM_ANDAMENTO (backcompat)', async () => {
      const res = await registrar([{ codigoSap: '1002343', qtdFisica: 1 }], false);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().inspecao.status, 'EM_ANDAMENTO');
    });
  });

  describe('exclusão de consumível/EPI do catálogo', () => {
    let itemId: string;

    it('qualquer usuário (mecânico incluído) pode excluir item do catálogo', async () => {
      const ent = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/entrada`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-f20-ent-mec',
          tipo: 'CONSUMIVEL',
          codigo: 'MEC-DEL',
          descricao: 'Item que o mecânico vai excluir',
          quantidade: 1,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F20-LDR',
          matriculaConfirmacao: 'F20-LDR',
        },
      });
      assert.equal(ent.statusCode, 200, ent.body);
      const itemMec = ent.json().entrada.itemId as string;

      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL/${itemMec}/excluir`,
        headers: auth(mecToken, DEV_MEC),
        payload: { motivo: 'Mecânico também pode excluir (fase 21)', assinaturaMatricula: 'F20-MEC', matriculaConfirmacao: 'F20-MEC' },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().excluido, true);
    });

    it('liderança cadastra consumível + solicitação aberta e exclui o item do catálogo', async () => {
      const ent = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/entrada`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-f20-ent-1',
          tipo: 'CONSUMIVEL',
          codigo: 'LUVA-M8',
          descricao: 'Luva de proteção',
          unidade: 'par',
          quantidade: 10,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F20-LDR',
          matriculaConfirmacao: 'F20-LDR',
        },
      });
      assert.equal(ent.statusCode, 200, ent.body);
      itemId = ent.json().entrada.itemId;

      const lista = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/consumables`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(lista.json().consumiveis.some((c: { id: string }) => c.id === itemId), true);

      const req = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/requests`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-f20-req-1',
          tipo: 'CONSUMIVEL',
          itens: [{ codigo: 'LUVA-M8', descricao: 'Luva de proteção', qtd: 2 }],
          assinaturaMatricula: 'F20-LDR',
          matriculaConfirmacao: 'F20-LDR',
        },
      });
      assert.equal(req.statusCode, 200, req.body);

      const antes = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/requests`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(antes.json().solicitacoes.length, 1);

      const ex = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL/${itemId}/excluir`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { motivo: 'Lançamento incorreto no catálogo', assinaturaMatricula: 'F20-LDR', matriculaConfirmacao: 'F20-LDR' },
      });
      assert.equal(ex.statusCode, 200, ex.body);
      assert.equal(ex.json().excluido, true);
      assert.equal(ex.json().movimentosExcluidos, 1);
      assert.equal(ex.json().solicitacoesExcluidas, 1);

      const depois = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/consumables`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(depois.json().consumiveis.some((c: { id: string }) => c.id === itemId), false);

      const reqsDepois = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/requests`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(reqsDepois.json().solicitacoes.length, 0, 'solicitação aberta deve ser encerrada (EXCLUIDA não lista)');

      const movs = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/consumables/${itemId}/movements`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(movs.json().movements.length, 0);
    });

    it('item inexistente → 404 e motivo curto → 400', async () => {
      const naoExiste = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/EPI/nao-existe/excluir`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { motivo: 'Item não existente mesmo', assinaturaMatricula: 'F20-LDR', matriculaConfirmacao: 'F20-LDR' },
      });
      assert.equal(naoExiste.statusCode, 404, naoExiste.body);

      const curto = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/EPI/nao-existe/excluir`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { motivo: 'oi', assinaturaMatricula: 'F20-LDR', matriculaConfirmacao: 'F20-LDR' },
      });
      assert.equal(curto.statusCode, 400, curto.body);
    });

    it('usuário sem acesso ao depósito recebe 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/EPI/x/excluir`,
        headers: auth(outroToken, DEV_OUT),
        payload: { motivo: 'Tentar excluir sem acesso ao depósito', assinaturaMatricula: 'F20-OUT' },
      });
      assert.equal(res.statusCode, 403, res.body);
    });
  });
});