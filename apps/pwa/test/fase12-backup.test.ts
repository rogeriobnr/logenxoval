import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/db';
import { BackUpErro, exportarBackupLocal, importarBackupLocal } from '../src/lib/backup';

const TABELAS_BACKUP = [
  'users',
  'deposits',
  'depositVersions',
  'inventoryItems',
  'goldboxMovements',
  'spareParts',
  'sparePartMovements',
  'consumables',
  'consumableMovements',
  'ppeItems',
  'ppeMovements',
  'requests',
  'inspections',
  'inspectionItems',
  'conversionSuggestions',
  'divergences',
  'auditLogs',
  'snapshots',
  'documents',
  'syncQueue',
  'processedOperations',
  'settings',
  'syncState',
];

beforeEach(async () => {
  await Promise.all(
    TABELAS_BACKUP.map((t) =>
      (db as unknown as Record<string, { clear: () => Promise<void> }>)[t].clear(),
    ),
  );
  await Promise.all([db.kv.clear(), db.session.clear()]);
});

async function seedDispositivo(): Promise<void> {
  await db.inventoryItems.put({
    id: 'item-f12',
    depositoId: 'd1',
    codigoSap: '1002341',
    textoBreve: 'Parafuso M8x20',
    qtdOficial: 10,
    qtdAtual: 7,
    utilizacaoLivre: true,
    status: 'ATIVO',
    versao: 'v1',
    criadoEm: '2026-09-24T10:00:00.000Z',
    atualizadoEm: '2026-09-24T10:00:00.000Z',
    usuarioResponsavel: 'F12-MEC',
  });
  await db.syncQueue.put({
    id: 'q-f12',
    operationId: 'op-f12-local-1',
    entidade: 'BAIXA',
    acao: 'CREATE',
    payload: { depositoId: 'd1', codigoSap: '1002341' },
    criadoEm: '2026-09-24T10:05:00.000Z',
    tentativas: 0,
    status: 'PENDENTE',
    proximaTentativaEm: '2026-09-24T10:10:00.000Z',
  });
  await db.processedOperations.put({ operationId: 'op-f12-processada-1' });
  await db.documents.put({
    id: 'doc-f12',
    depositoId: 'd1',
    tipo: 'FOTO',
    nome: 'folha.jpg',
    mime: 'image/jpeg',
    tamanho: 4,
    hashDocumento: 'abab',
    bytes: new Blob(['x']) as unknown as Blob,
    criadoEm: '2026-09-24T10:00:00.000Z',
    usuarioId: 'u1',
    matricula: 'F12-MEC',
  });
}

test('exportar gera um .lxb com envelope v1 (magic, salt, iv, data) e dados cifrados', async () => {
  await seedDispositivo();
  const blob = await exportarBackupLocal('senha-segura');
  assert.ok(blob.type === 'application/octet-stream' || blob.type === '');
  const texto = await blob.text();
  const env = JSON.parse(texto) as {
    magic: string;
    v: number;
    salt: string;
    iv: string;
    data: string;
  };
  assert.equal(env.magic, 'LOGENXOVAL-BACKUP');
  assert.equal(env.v, 1);
  assert.ok(env.salt.length > 0);
  assert.ok(env.iv.length > 0);
  assert.ok(env.data.length > 0);
  // O conteúdo cifrado não vaza texto puro dos dados.
  assert.equal(texto.includes('Parafuso M8x20'), false);
});

test('round-trip restaura espelhos/fila preferindo operationId e documentos (teste #30)', async () => {
  await seedDispositivo();
  const blob = await exportarBackupLocal('minha-senha');
  const texto = await blob.text();

  // Simula um outro aparelho/banco vazio.
  await db.inventoryItems.clear();
  await db.syncQueue.clear();
  await db.processedOperations.clear();
  await db.documents.clear();

  const resumo = await importarBackupLocal('minha-senha', texto);
  assert.ok(resumo.tabelas.includes('inventoryItems'));
  assert.ok(resumo.tabelas.includes('syncQueue'));
  assert.ok(resumo.tabelas.includes('processedOperations'));

  const item = await db.inventoryItems.get('item-f12');
  assert.equal(item?.codigoSap, '1002341');
  assert.equal(item?.qtdAtual, 7);

  const fila = await db.syncQueue.toArray();
  assert.equal(fila.length, 1);
  assert.equal(fila[0].operationId, 'op-f12-local-1', 'operationId deve ser preservado na restauração');
  assert.equal(fila[0].status, 'PENDENTE');

  const processados = await db.processedOperations.toArray();
  assert.equal(processados.length, 1);
  assert.equal(processados[0].operationId, 'op-f12-processada-1');

  const doc = await db.documents.get('doc-f12') as { bytes?: Blob };
  assert.ok(doc?.bytes instanceof Blob, 'bytes do documento devem voltar como Blob');
});

test('backup não inclui session nem kv (sessão atual do aparelho é mantida)', async () => {
  await db.kv.put({ key: 'deviceId', value: 'dev-f12' });
  await db.session.put({
    userId: 'u1',
    matricula: 'F12-MEC',
    nomeCompleto: 'Mário Mec',
    perfil: 'MECANICO',
    depositos: [],
    depositoAtivo: '',
    saltLocal: 'salt',
    hashLocal: 'hash',
    loginEm: '2026-09-24T10:00:00.000Z',
    expiresAt: '2026-09-25T10:00:00.000Z',
    lastActivityAt: '2026-09-24T10:00:00.000Z',
  });
  await db.auditLogs.put({
    id: 'log-f12',
    tipo: 'BAIXA',
    dataHora: '2026-09-24T10:00:00.000Z',
    usuarioId: 'u1',
    matricula: 'F12-MEC',
    depositoId: 'd1',
    entidade: 'goldbox_movements',
    origem: 'ONLINE',
    dispositivo: 'dev-f12',
    hash: 'h',
  });
  const blob = await exportarBackupLocal('chave');
  const resumo = await importarBackupLocal('chave', await blob.text());
  assert.equal(resumo.tabelas.includes('session'), false);
  assert.equal(resumo.tabelas.includes('kv'), false);
  assert.equal(resumo.tabelas.includes('auditLogs'), true);
  assert.equal((await db.session.get('u1'))?.matricula, 'F12-MEC');
});

test('senha errada na restauração → BackUpErro', async () => {
  await seedDispositivo();
  const blob = await exportarBackupLocal('senha-ok');
  await assert.rejects(importarBackupLocal('senha-errada', await blob.text()), BackUpErro);
});

test('arquivo não-lxb → BackUpErro', async () => {
  await assert.rejects(importarBackupLocal('x', 'não é json'), BackUpErro);
});

test('backup com schemaVersion futura → BackUpErro', async () => {
  await seedDispositivo();
  const { ITERACOES, bytesToBase64 } = await import('../src/lib/crypto');
  const conteudo = JSON.stringify({ schemaVersion: 99, criadoEm: new Date().toISOString(), tabelas: {} });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('senha-ok'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERACOES, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(conteudo),
  );
  const futuro = JSON.stringify({
    magic: 'LOGENXOVAL-BACKUP',
    v: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cifrado),
  });
  await assert.rejects(importarBackupLocal('senha-ok', futuro), BackUpErro);
});