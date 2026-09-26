import type { FastifyInstance } from 'fastify';
import { requireAcao } from '../plugins/auth';
import { userHasDepositAccess } from '../repos/depositsRepo';
import { AppError } from '../lib/errors';
import { loadEnv } from '../env';
import { analisarImagemGemini, GeminiOcrError } from '../lib/geminiOcr';

// ~5 MB de arquivo em base64 (7 MB de texto)
const MAX_BASE64 = 7 * 1024 * 1024;
const BODY_LIMIT = 8 * 1024 * 1024;

const MIMES_SUPORTADOS: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
};

interface OcrAiBody {
  depositoId?: string;
  base64?: string;
  mime?: string;
}

export async function registerOcrRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/ocr/ai',
    { preHandler: [requireAcao('IMPORTAR_ENXOVAL')], bodyLimit: BODY_LIMIT },
    async (req) => {
      const user = req.authUser!;
      const { depositoId, base64, mime } = (req.body ?? {}) as OcrAiBody;

      if (!depositoId) throw new AppError('VALIDATION_FAILED', 'depositoId é obrigatório', 400);
      if (typeof base64 !== 'string' || base64.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'base64 (conteúdo do arquivo) é obrigatório', 400);
      }
      if (base64.length > MAX_BASE64) {
        throw new AppError('VALIDATION_FAILED', 'Arquivo excede o limite de ~5 MB para reconhecimento', 413);
      }
      const mimeOk = mime ? MIMES_SUPORTADOS[mime] : undefined;
      if (!mimeOk) {
        throw new AppError('VALIDATION_FAILED', 'Tipo de arquivo não suportado (use imagem JPEG/PNG/WebP ou PDF)', 415);
      }
      const ok = await userHasDepositAccess(user.sub, depositoId, user.perfil);
      if (!ok) {
        throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
      }

      const apiKey = loadEnv().GEMINI_API_KEY;
      if (!apiKey) {
        throw new AppError('IA_NAO_CONFIGURADA', 'Reconhecimento por IA não configurado (GEMINI_API_KEY ausente no servidor).', 501);
      }

      try {
        const { texto } = await analisarImagemGemini({ apiKey, base64, mime: mimeOk });
        return { texto };
      } catch (err) {
        if (err instanceof GeminiOcrError) {
          throw new AppError('IA_FALHOU', err.message, 502);
        }
        throw err;
      }
    },
  );
}