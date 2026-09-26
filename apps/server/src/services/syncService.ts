import type { FastifyInstance } from 'fastify';
import type { Perfil } from '@logenxoval/contracts';
import {
  syncBodySchema,
  syncPayloadBaixaSchema,
  syncPayloadEntradaEstoqueSchema,
  syncPayloadEntradaMaterialSchema,
  syncPayloadSolicitacaoSchema,
  syncPayloadSolicitacaoTransitionSchema,
  syncPayloadSparePartEntradaSchema,
  syncPayloadSparePartSaidaSchema,
  syncPayloadSugestaoRespostaSchema,
} from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { userHasDepositAccess } from '../repos/depositsRepo';
import { registrarBaixa, registrarEntrada } from './goldboxService';
import { registrarEntradaEstoque } from './estoqueService';
import { registrarEntradaPeca, movimentarPecaAvulsa } from './spareService';
import { responderSugestaoConversao } from './suggestionService';
import { registrarSolicitacao, transicionarSolicitacaoService } from './requestService';

export interface SyncDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: Perfil };
  dispositivo: string;
}

interface SyncResult {
  acks: Array<{ operationId: string; status: 'OK' | 'JA_PROCESSADO' }>;
  conflicts: Array<{ operationId: string; tipo: string; detalhe?: string }>;
  errors: Array<{ operationId: string; code: string; message?: string }>;
}

/**
 * Fase 05: processa o lote push do cliente (baixas offline).
 * Cada operação usa a mesma idempotência por operationId das baixas online
 * (processed_operations) — reenvios viram ACK JA_PROCESSADO (docs 7.6/8.5).
 */
export async function processarSync(deps: SyncDeps, body: typeof syncBodySchema._type): Promise<SyncResult> {
  const acesso = await userHasDepositAccess(deps.authUser.sub, body.depositoId, deps.authUser.perfil);
  if (!acesso) {
    throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
  }

  const acks: SyncResult['acks'] = [];
  const conflicts: SyncResult['conflicts'] = [];
  const errors: SyncResult['errors'] = [];

  for (const op of body.operations) {
    try {
      if (op.acao !== 'CREATE') {
        throw new AppError('VALIDATION_FAILED', 'Operação não suportada na sincronização', 400);
      }
      const ctx = { app: deps.app, authUser: deps.authUser, dispositivo: deps.dispositivo, origem: 'OFFLINE' as const };
      switch (op.entidade) {
        case 'BAIXA': {
          const p = syncPayloadBaixaSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de baixa', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          const res = await registrarBaixa(ctx, {
            depositoId: body.depositoId,
            operationId: op.operationId,
            codigoSap: p.data.codigoSap,
            materialId: p.data.materialId,
            descricao: p.data.descricao,
            quantidade: p.data.quantidade,
            reposicao: p.data.reposicao,
            origem: 'OFFLINE',
            dispositivo: deps.dispositivo,
            dataHora: p.data.dataHora,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'SPARE_PART_ENTRADA': {
          const p = syncPayloadSparePartEntradaSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de entrada de peça avulsa', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          const res = await registrarEntradaPeca(ctx, {
            depositoId: body.depositoId,
            operationId: op.operationId,
            codigoSap: p.data.codigoSap,
            descricao: p.data.descricao,
            foto: p.data.foto,
            origem: p.data.origem,
            quantidade: p.data.quantidade,
            observacao: p.data.observacao,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'SPARE_PART_SAIDA': {
          const p = syncPayloadSparePartSaidaSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de saída de peça avulsa', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          const res = await movimentarPecaAvulsa(ctx, {
            depositoId: body.depositoId,
            sparePartId: p.data.sparePartId,
            operationId: op.operationId,
            tipo: p.data.tipo,
            quantidade: p.data.quantidade,
            novoSaldo: p.data.novoSaldo,
            motivo: p.data.motivo,
            pin: p.data.pin,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: 'OK' });
          break;
        }
        case 'ENTRADA_MATERIAL': {
          const p = syncPayloadEntradaMaterialSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de entrada de material', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          if (deps.authUser.perfil === 'MECANICO') {
            throw new AppError('PERMISSAO_NEGADA', 'Entrada de material exige LIDER ou ADMIN', 403);
          }
          const res = await registrarEntrada(ctx, {
            depositoId: body.depositoId,
            operationId: op.operationId,
            codigoSap: p.data.codigoSap,
            materialId: p.data.materialId,
            descricao: p.data.descricao,
            quantidade: p.data.quantidade,
            observacao: p.data.observacao,
            origem: 'OFFLINE',
            dispositivo: deps.dispositivo,
            dataHora: p.data.dataHora,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'ENTRADA_ESTOQUE': {
          const p = syncPayloadEntradaEstoqueSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de entrada de consumível/EPI', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          if (deps.authUser.perfil === 'MECANICO') {
            throw new AppError('PERMISSAO_NEGADA', 'Entrada de consumível/EPI exige LIDER ou ADMIN', 403);
          }
          const res = await registrarEntradaEstoque(ctx, {
            depositoId: body.depositoId,
            operationId: op.operationId,
            tipo: p.data.tipo,
            codigo: p.data.codigo,
            descricao: p.data.descricao,
            unidade: p.data.unidade,
            estoqueMinimo: p.data.estoqueMinimo,
            quantidade: p.data.quantidade,
            observacao: p.data.observacao,
            origem: 'OFFLINE',
            dispositivo: deps.dispositivo,
            dataHora: p.data.dataHora,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'SUGESTAO_ACEITA':
        case 'SUGESTAO_RECUSADA': {
          const p = syncPayloadSugestaoRespostaSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de sugestão', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          const acao = op.entidade === 'SUGESTAO_ACEITA' ? 'ACEITA' : 'RECUSADA';
          const res = await responderSugestaoConversao(ctx, {
            depositoId: body.depositoId,
            suggestionId: p.data.suggestionId,
            operationId: op.operationId,
            acao,
            motivo: p.data.motivo,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'SOLICITACAO': {
          const p = syncPayloadSolicitacaoSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de solicitação', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          if (p.data.solicitanteId !== deps.authUser.sub) {
            throw new AppError('PERMISSAO_NEGADA', 'solicitanteId da operação diverge do usuário', 403);
          }
          const res = await registrarSolicitacao(ctx, {
            depositoId: body.depositoId,
            operationId: op.operationId,
            tipo: p.data.tipo,
            itens: p.data.itens,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao ?? deps.authUser.matricula,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        case 'SOLICITACAO_TRANSICAO': {
          const p = syncPayloadSolicitacaoTransitionSchema.safeParse(op.payload);
          if (!p.success) {
            throw new AppError('VALIDATION_FAILED', 'Payload inválido na transição de solicitação', 400);
          }
          if (p.data.depositoId !== body.depositoId) {
            throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
          }
          const res = await transicionarSolicitacaoService(ctx, {
            operationId: op.operationId,
            depositoId: body.depositoId,
            requestId: p.data.requestId,
            para: p.data.para,
            motivo: p.data.motivo,
            pin: p.data.pin,
            assinaturaMatricula: p.data.assinaturaMatricula,
            matriculaConfirmacao: p.data.matriculaConfirmacao ?? deps.authUser.matricula,
          });
          acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
          break;
        }
        default:
          throw new AppError('VALIDATION_FAILED', 'Operação não suportada na sincronização', 400);
      }
    } catch (err) {
      if (err instanceof AppError) {
        errors.push({ operationId: op.operationId, code: err.code, message: err.message });
      } else {
        errors.push({ operationId: op.operationId, code: 'INTERNAL', message: 'Erro interno ao processar a operação' });
      }
    }
  }

  return { acks, conflicts, errors };
}