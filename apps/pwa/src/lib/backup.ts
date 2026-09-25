/**
 * Backup do dispositivo (.lxb) — docs 14.2/14.4.
 * Exporta o IndexedDB (espelhos + fila + config) como JSON criptografado
 * com chave derivada da senha do usuário via PBKDF2 + AES-GCM.
 * session/kv NÃO entram no arquivo: ao importar, o usuário segue autenticado
 * no mesmo aparelho e o servidor re-ack os operationIds (idempotência).
 */
import { db } from '../db/db';
import { ITERACOES, base64ToBytes, bytesToBase64 } from './crypto';

export const EXTENSAO_BACKUP = '.lxb';
export const BACKUP_MAGIC = 'LOGENXOVAL-BACKUP';

export class BackUpErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackUpErro';
  }
}

const NOMES_TABELAS = [
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
] as const;

interface LinhaDocumento {
  id: string;
  bytes?: Blob | Buffer;
  [campo: string]: unknown;
}

async function bytesParaB64(bytes: Uint8Array | Blob): Promise<string> {
  const ab = bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : await bytes.arrayBuffer();
  return bytesToBase64(new Uint8Array(ab));
}

/**
 * Leitura/escrita das tabelas de backup com tratamento do Blob binário dos
 * documentos (não serializa com JSON via structured data).
 */
async function coletarTabelas(): Promise<Record<string, unknown[]>> {
  const tabelas: Record<string, unknown[]> = {};
  for (const nome of NOMES_TABELAS) {
    const rows: unknown[] = await (db as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[nome].toArray();
    if (nome === 'documents') {
      for (const row of rows) {
        const d = row as LinhaDocumento;
        if (d.bytes) {
          const b64 = await bytesParaB64(d.bytes as Blob);
          (row as Record<string, unknown>).bytesB64 = b64;
        }
        delete (row as Record<string, unknown>).bytes;
      }
    }
    tabelas[nome] = rows;
  }
  return tabelas;
}

function aplicarTabelas(tabelas: Record<string, unknown[]>): Promise<void> {
  return (async () => {
    for (const nome of NOMES_TABELAS) {
      const tabela = (db as unknown as Record<string, {
        clear: () => Promise<void>;
        bulkAdd: (rows: unknown[]) => Promise<unknown>;
      }>)[nome];
      const rows = tabelas[nome] ?? [];
      if (nome === 'documents') {
        for (const row of rows) {
          const d = row as LinhaDocumento & { bytesB64?: string };
          if (d.bytesB64) {
            (d as { bytes?: Blob }).bytes = new Blob([base64ToBytes(d.bytesB64)]);
          }
          delete d.bytesB64;
        }
      }
      await tabela.clear();
      if (rows.length > 0) await tabela.bulkAdd(rows);
    }
  })();
}

interface Envelope {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

interface ConteudoBackup {
  schemaVersion: 1;
  criadoEm: string;
  tabelas: Record<string, unknown[]>;
}

async function chaveAes(senha: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERACOES, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function lerEnvelope(conteudo: string): Envelope {
  let raw: unknown;
  try {
    raw = JSON.parse(conteudo);
  } catch {
    throw new BackUpErro('Arquivo de backup inválido (não é um .lxb)');
  }
  const env = raw as Partial<Envelope>;
  if (env.v !== 1 || typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.data !== 'string') {
    throw new BackUpErro('Arquivo de backup inválido (formato desconhecido)');
  }
  return env as Envelope;
}

/** Exporta o backup do dispositivo cifrado com a senha do usuário e devolve Blob .lxb. */
export async function exportarBackupLocal(senha: string): Promise<Blob> {
  if (!senha) throw new BackUpErro('Senha obrigatória para o backup');
  const conteudo: ConteudoBackup = {
    schemaVersion: 1,
    criadoEm: new Date().toISOString(),
    tabelas: await coletarTabelas(),
  };
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const key = await chaveAes(senha, salt);
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(conteudo)),
  );
  const envelope = {
    magic: BACKUP_MAGIC,
    v: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cifrado),
  };
  return new Blob([JSON.stringify(envelope)], { type: 'application/octet-stream' });
}

/**
 * Importa e aplica o backup .lxb, substituindo os espelhos/fila/config local.
 * Preserva a sessão atual; a primeira sync re-ack os operationIds preservados.
 */
export async function importarBackupLocal(senha: string, conteudoArquivo: string): Promise<{ criadoEm: string; tabelas: string[] }> {
  if (!senha) throw new BackUpErro('Senha obrigatória para a restauração');
  const env = lerEnvelope(conteudoArquivo);
  const salt = base64ToBytes(env.salt);
  const iv = base64ToBytes(env.iv);
  const key = await chaveAes(senha, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(env.data),
    );
  } catch {
    throw new BackUpErro('Senha inválida para este backup (ou arquivo corrompido)');
  }
  let conteudo: ConteudoBackup;
  try {
    conteudo = JSON.parse(new TextDecoder().decode(plain)) as ConteudoBackup;
  } catch {
    throw new BackUpErro('Conteúdo do backup inválido');
  }
  if (conteudo.schemaVersion !== 1) {
    throw new BackUpErro('Versão do backup não suportada por este app');
  }
  await aplicarTabelas(conteudo.tabelas);
  return {
    criadoEm: conteudo.criadoEm,
    tabelas: Object.keys(conteudo.tabelas),
  };
}