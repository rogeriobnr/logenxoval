import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LDR = 'dev-fase09-lider';
const DEV_MEC = 'dev-fase09-mec';
const OP = (n: string) => `op-fase09-${n}`;

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

function multipart(boundary: string, fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>) {
  const parts: Buffer[] = [];
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) head += `; filename="${f.filename}"`;
    let tail = '\r\n';
    if (f.contentType) tail += `Content-Type: ${f.contentType}\r\n`;
    head += `${tail}\r\n`;
    parts.push(Buffer.from(head));
    parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(f.value));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

describe('fase09 - documentos e OCR (importação por foto/PDF)', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;
  let docId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F9-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F9-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F9-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F9-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5509', nome: 'Depósito OCR', matriculaConfirmacao: 'F9-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('mecânico não pode enviar documento (exige liderança) → 403', async () => {
    const body = multipart('b0', [
      { name: 'file', value: Buffer.from('foto-falsa'), filename: 'folha.jpg', contentType: 'image/jpeg' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/documents?depositoId=${dep}`,
      headers: { ...auth(mecToken, DEV_MEC), 'content-type': 'multipart/form-data; boundary=b0' },
      payload: body,
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  it('upload sem depositoId → 400', async () => {
    const body = multipart('b1', [
      { name: 'file', value: Buffer.from('foto-falsa'), filename: 'folha.jpg', contentType: 'image/jpeg' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: { ...auth(liderToken, DEV_LDR), 'content-type': 'multipart/form-data; boundary=b1' },
      payload: body,
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it('upload de imagem → { documento: { id, hash } } com conteúdo persistido', async () => {
    const pic = Buffer.from('jpeg-bytes-de-verdade');
    const body = multipart('b2', [
      { name: 'file', value: pic, filename: 'folha.jpg', contentType: 'image/jpeg' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/documents?depositoId=${dep}`,
      headers: { ...auth(liderToken, DEV_LDR), 'content-type': 'multipart/form-data; boundary=b2' },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const { documento } = res.json();
    assert.ok(documento.id);
    assert.match(documento.hash, /^[a-f0-9]{64}$/);
    docId = documento.id;

    // hash deve ser o sha256 dos bytes enviados
    const { createHash } = await import('node:crypto');
    assert.equal(documento.hash, createHash('sha256').update(pic).digest('hex'));
  });

  it('recupera o documento com mime e bytes (Range suportado)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/documents/${docId}?depositoId=${dep}`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    const buf = Buffer.from(res.rawPayload);
    assert.equal(buf.toString(), 'jpeg-bytes-de-verdade');

    const range = await app.inject({
      method: 'GET',
      url: `/documents/${docId}?depositoId=${dep}`,
      headers: { ...auth(liderToken, DEV_LDR), range: 'bytes=0-4' },
    });
    assert.equal(range.statusCode, 206, range.body);
    assert.equal(Buffer.from(range.rawPayload).toString(), 'jpeg-');
  });

  it('tipo de arquivo não suportado → 415', async () => {
    const body = multipart('b3', [
      { name: 'file', value: Buffer.from('texto'), filename: 'nota.txt', contentType: 'text/plain' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/documents?depositoId=${dep}`,
      headers: { ...auth(liderToken, DEV_LDR), 'content-type': 'multipart/form-data; boundary=b3' },
      payload: body,
    });
    assert.equal(res.statusCode, 415, res.body);
  });

  it('documento de outro depósito → 403/404', async () => {
    const d2 = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5598', nome: 'Depósito 2', matriculaConfirmacao: 'F9-LDR' },
    });
    const dep2 = d2.json().deposito.id;
    const res = await app.inject({
      method: 'GET',
      url: `/documents/${docId}?depositoId=${dep2}`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 404, res.body);
  });

  it('publicação via documento: gera IMPORTACAO_FOLHA + snapshot DEPOIS + sugestão de conversão', async () => {
    // Seed: publica v1 normal e cria peça avulsa para um SAP da nova lista.
    const v1 = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        motivo: 'Versão base OCR',
        matriculaConfirmacao: 'F9-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true },
        ],
      },
    });
    assert.equal(v1.statusCode, 200, v1.body);

    const sp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/spare-parts`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        operationId: OP('peca-ocr'),
        codigoSap: '1002341',
        descricao: 'Parafuso M8x20',
        origem: 'BACKLOG',
        quantidade: 4,
        assinaturaMatricula: 'F9-LDR',
      },
    });
    assert.equal(sp.statusCode, 200, sp.body);

    // Publica v2 referenciando o documento, quantidade abaixo do previsto.
    const pub = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        documentoId: docId,
        refFolha: 'folha-2026-09',
        motivo: 'Importação por OCR da folha',
        matriculaConfirmacao: 'F9-LDR',
        itens: [
          // previsto 12, físico 10 → deficit 2 com 4 peças disponíveis → sugestão PENDENTE
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 12, qtdAtual: 10, utilizacaoLivre: true },
        ],
      },
    });
    assert.equal(pub.statusCode, 200, pub.body);
    const pubJson = pub.json();
    assert.equal(pubJson.versao.versao, 2);
    assert.equal(pubJson.versao.documentoId, docId);
    assert.equal(pubJson.versao.refFolha, 'folha-2026-09');

    // Auditoria: IMPORTACAO_FOLHA e PUBLICACAO_ENXOVAL presentes.
    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(liderToken, DEV_LDR),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('IMPORTACAO_FOLHA'), `faltou IMPORTACAO_FOLHA: ${tipos.join(',')}`);
    assert.ok(tipos.includes('PUBLICACAO_ENXOVAL'), `faltou PUBLICACAO_ENXOVAL: ${tipos.join(',')}`);
    assert.ok(tipos.includes('SUGESTAO_CRIADA'), `faltou SUGESTAO_CRIADA: ${tipos.join(',')}`);

    // Snapshot DEPOIS criado.
    const { getPool } = await import('../src/db/pool');
    const snap = await getPool().query('SELECT * FROM snapshots WHERE deposito_id = $1', [dep]);
    assert.ok((snap as { rows: unknown[] }).rows.length >= 1);

    // Sugestão PENDENTE gerada para o SAP com peça avulsa saldo < previsto.
    const sugs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/conversion-suggestions`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(sugs.statusCode, 200, sugs.body);
    const pedentes = sugs.json().sugestoes.filter((s: { status: string }) => s.status === 'PENDENTE');
    assert.ok(pedentes.some((s: { codigoSap: string; qtdSugerida: number }) => s.codigoSap === '1002341' && s.qtdSugerida > 0));
  });
});