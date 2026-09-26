import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { analisarImagemGemini, GeminiOcrError } from '../src/lib/geminiOcr';

function auth(token: string, device: string) {
  return { authorization: `Bearer ${token}`, 'x-device-id': device };
}

function respostaGemini(texto?: string, extra?: Record<string, unknown>) {
  const body = texto
    ? { candidates: [{ content: { parts: [{ text: texto }] } }], ...extra }
    : (extra ?? { candidates: [] });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('geminiOcr (lib)', () => {
  it('envia imagem base64 inline e devolve o texto do candidato', async () => {
    let corpoEnviado: { contents?: unknown } = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      corpoEnviado = JSON.parse(String(init.body));
      return respostaGemini('1001234 Parafuso 10\n2005678 Vela 4 un');
    };
    const { texto } = await analisarImagemGemini({
      apiKey: 'chave',
      base64: 'YWJj',
      mime: 'image/jpeg',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(texto, '1001234 Parafuso 10\n2005678 Vela 4 un');
    const parts = (corpoEnviado.contents as Array<{ parts: unknown[] }>)[0].parts;
    assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } });
  });

  it('recusa HTTP não-200 propagando a mensagem da API', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'API key inválida' } }), { status: 403, headers: { 'content-type': 'application/json' } });
    await assert.rejects(
      () => analisarImagemGemini({ apiKey: 'x', base64: 'YQ==', mime: 'image/png', fetchImpl: fetchImpl as unknown as typeof fetch }),
      (err) => {
        assert.ok(err instanceof GeminiOcrError);
        assert.equal((err as GeminiOcrError).status, 403);
        assert.match((err as Error).message, /API key inválida/);
        return true;
      },
    );
  });

  it('sem candidatos/texto → erro de serviço', async () => {
    await assert.rejects(
      () => analisarImagemGemini({ apiKey: 'x', base64: 'YQ==', mime: 'image/png', fetchImpl: (async () => respostaGemini()) as unknown as typeof fetch }),
      (err) => {
        assert.ok(err instanceof GeminiOcrError);
        assert.match((err as Error).message, /não retornou texto/);
        return true;
      },
    );
  });
});

async function seedUser(opts: { matricula: string; nome: string; sobrenome: string; perfil: 'MECANICO' | 'LIDER' | 'ADMIN' }) {
  const senhaHash = await bcrypt.hash('senha-teste-123', 4);
  return createUser({ ...opts, senhaHash });
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

describe('rota POST /ocr/ai', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;
  const ORIGINAL_FETCH = globalThis.fetch;
  const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'IA-LDR', nome: 'Ivo', sobrenome: 'Lider', perfil: 'LIDER' });
    await seedUser({ matricula: 'IA-MEC', nome: 'Ivo', sobrenome: 'Mec', perfil: 'MECANICO' });
    liderToken = (await login(app, 'IA-LDR', 'dev-ia-ldr')).accessToken;
    mecToken = (await login(app, 'IA-MEC', 'dev-ia-mec')).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, 'dev-ia-ldr'),
      payload: { numero: '8082', nome: 'Depósito IA', matriculaConfirmacao: 'IA-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
  });

  after(async () => {
    await app.close();
    await closePool();
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
  });

  it('sem GEMINI_API_KEY → 501 (PWA cai para o OCR local)', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await app.inject({
      method: 'POST',
      url: '/ocr/ai',
      headers: auth(liderToken, 'dev-ia-ldr'),
      payload: { depositoId: dep, base64: 'YWJj', mime: 'image/jpeg' },
    });
    assert.equal(res.statusCode, 501);
    assert.equal(res.json().error.code, 'IA_NAO_CONFIGURADA');
  });

  it('validações: depositoId, base64, limite e mime', async () => {
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    const base = { depositoId: dep, base64: 'YWJj', mime: 'image/jpeg' };

    let res = await app.inject({ method: 'POST', url: '/ocr/ai', headers: auth(liderToken, 'dev-ia-ldr'), payload: { ...base, depositoId: undefined } });
    assert.equal(res.statusCode, 400);

    res = await app.inject({ method: 'POST', url: '/ocr/ai', headers: auth(liderToken, 'dev-ia-ldr'), payload: { ...base, base64: '' } });
    assert.equal(res.statusCode, 400);

    res = await app.inject({ method: 'POST', url: '/ocr/ai', headers: auth(liderToken, 'dev-ia-ldr'), payload: { ...base, mime: 'image/gif' } });
    assert.equal(res.statusCode, 415);

    res = await app.inject({
      method: 'POST',
      url: '/ocr/ai',
      headers: auth(liderToken, 'dev-ia-ldr'),
      payload: { ...base, base64: 'A'.repeat(8 * 1024 * 1024) },
    });
    assert.equal(res.statusCode, 413);
  });

  it('mecânico sem acesso ao depósito → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ocr/ai',
      headers: auth(mecToken, 'dev-ia-mec'),
      payload: { depositoId: dep, base64: 'YWJj', mime: 'image/jpeg' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('sucesso: devolve { texto } com mock do Gemini', async () => {
    let payloadRecebido: { contents?: unknown } = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      payloadRecebido = JSON.parse(String(init.body));
      return respostaGemini('1001234 Parafuso 10\n2005678 Vela 4 un');
    }) as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/ocr/ai',
      headers: auth(liderToken, 'dev-ia-ldr'),
      payload: { depositoId: dep, base64: 'YWJj', mime: 'image/jpeg' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.json().texto, /1001234 Parafuso 10/);
    const parts = (payloadRecebido.contents as Array<{ parts: unknown[] }>)[0].parts;
    assert.equal((parts[0] as { inlineData: { data: string } }).inlineData.data, 'YWJj');
  });

  it('falha da API Gemini → 502 IA_FALHOU', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const res = await app.inject({
      method: 'POST',
      url: '/ocr/ai',
      headers: auth(liderToken, 'dev-ia-ldr'),
      payload: { depositoId: dep, base64: 'YWJj', mime: 'image/jpeg' },
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'IA_FALHOU');
  });
});