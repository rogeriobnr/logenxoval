import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import fastifyMultipart from '@fastify/multipart';
import { requireAcao } from '../plugins/auth';
import { userHasDepositAccess } from '../repos/depositsRepo';
import { findDocumentoPorDeposito, insertDocumento, listDocumentosByDeposito } from '../repos/documentsRepo';
import { AppError } from '../lib/errors';

const MAX_UPLOAD = 20 * 1024 * 1024;

const MIMES_SUPORTADOS: Record<string, 'FOTO' | 'PDF'> = {
  'image/jpeg': 'FOTO',
  'image/png': 'FOTO',
  'image/webp': 'FOTO',
  'application/pdf': 'PDF',
};

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD, files: 1, fields: 20 },
  });

  app.post(
    '/documents',
    { preHandler: [requireAcao('IMPORTAR_ENXOVAL')] },
    async (req) => {
      const user = req.authUser!;
      const depositoId = (req.query as { depositoId?: string }).depositoId;
      if (!depositoId) throw new AppError('VALIDATION_FAILED', 'depositoId é obrigatório', 400);
      const ok = await userHasDepositAccess(user.sub, depositoId, user.perfil);
      if (!ok) {
        throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
      }

      let nome = 'documento';
      let mime = '';
      let bytes: Buffer | null = null;
      try {
        const data = await req.file();
        if (!data) throw new AppError('VALIDATION_FAILED', 'Nenhum arquivo enviado', 400);
        nome = data.filename;
        mime = data.mimetype;
        bytes = await data.toBuffer();
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        const msg = err instanceof Error ? err.message : '';
        if (status === 413 || msg.toLowerCase().includes('too large')) {
          throw new AppError('VALIDATION_FAILED', 'Arquivo excede o limite de 20 MB', 413);
        }
        throw err;
      }
      if (!bytes || bytes.length === 0) throw new AppError('VALIDATION_FAILED', 'Arquivo vazio', 400);
      const tipo = MIMES_SUPORTADOS[mime];
      if (!tipo) {
        throw new AppError('VALIDATION_FAILED', 'Tipo de arquivo não suportado (use imagem ou PDF)', 415);
      }
      if (bytes.length > MAX_UPLOAD) {
        throw new AppError('VALIDATION_FAILED', 'Arquivo excede o limite de 20 MB', 413);
      }

      const hashDocumento = createHash('sha256').update(bytes).digest('hex');
      const documento = await insertDocumento(
        {
          depositoId,
          tipo,
          nome,
          mime,
          tamanho: bytes.length,
          hashDocumento,
          bytes,
          usuarioId: user.sub,
          matricula: user.matricula,
        },
        user.perfil,
      );

      return { documento: { id: documento.id, hash: documento.hashDocumento } };
    },
  );

  app.get('/documents/:id', { preHandler: [requireAcao('IMPORTAR_ENXOVAL')] }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const depositoId = (req.query as { depositoId?: string }).depositoId;
    if (!depositoId) throw new AppError('VALIDATION_FAILED', 'depositoId é obrigatório', 400);
    const ok = await userHasDepositAccess(user.sub, depositoId, user.perfil);
    if (!ok) {
      throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
    }
    const doc = await findDocumentoPorDeposito(depositoId, user.perfil, id);
    if (!doc) throw new AppError('NAO_ENCONTRADO', 'Documento não encontrado', 404);
    if (!doc.bytes) throw new AppError('NAO_ENCONTRADO', 'Documento sem conteúdo', 404);

    const buf: Buffer = Buffer.isBuffer(doc.bytes)
      ? doc.bytes
      : Buffer.from(await doc.bytes.arrayBuffer());
    let from = 0;
    let to = buf.length - 1;
    const range = req.headers.range as string | undefined;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m && m[1]) {
        from = Number(m[1]);
        if (m[2]) to = Math.min(Number(m[2]), buf.length - 1);
        if (from > to) throw new AppError('VALIDATION_FAILED', 'Range inválido', 416);
      }
    }
    const total = buf.length;
    const chunk = buf.subarray(from, to + 1);
    reply
      .status(range ? 206 : 200)
      .headers({
        'content-type': doc.mime,
        'content-length': chunk.length,
        'accept-ranges': 'bytes',
        ...(range
          ? { 'content-range': `bytes ${from}-${to}/${total}` }
          : {}),
      })
      .send(chunk);
  });

  app.get('/documents', { preHandler: [requireAcao('IMPORTAR_ENXOVAL')] }, async (req) => {
    const user = req.authUser!;
    const depositoId = (req.query as { depositoId?: string }).depositoId;
    if (!depositoId) throw new AppError('VALIDATION_FAILED', 'depositoId é obrigatório', 400);
    const ok = await userHasDepositAccess(user.sub, depositoId, user.perfil);
    if (!ok) {
      throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
    }
    const documentos = await listDocumentosByDeposito(depositoId, user.perfil);
    return { documentos };
  });
}