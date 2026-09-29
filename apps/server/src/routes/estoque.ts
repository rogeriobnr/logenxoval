import type { FastifyInstance } from 'fastify';
import {
  estoqueEntradaBodySchema,
  estoqueExcluirBodySchema,
  estoqueItemCreateBodySchema,
  estoqueItemUpdateBodySchema,
  solicitacaoCreateBodySchema,
  solicitacaoTransitionBodySchema,
} from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { listarConsumiveis, listarMovimentosConsumivel, listarMovimentosPpe, listarPpeItems } from '../repos/estoqueRepo';
import { listarSolicitacoes } from '../repos/requestRepo';
import * as estoqueService from '../services/estoqueService';
import * as requestService from '../services/requestService';

export async function registerEstoqueRoutes(app: FastifyInstance): Promise<void> {
  const prehandler = [authenticate, requireDepositoAcesso()];

  app.get('/deposits/:depositoId/consumables', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const consumiveis = await listarConsumiveis(depositoId, req.authUser!.perfil);
    return { consumiveis };
  });

  app.get('/deposits/:depositoId/ppe', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const ppe = await listarPpeItems(depositoId, req.authUser!.perfil);
    return { ppe };
  });

  app.get('/deposits/:depositoId/consumables/:consumableId/movements', { preHandler: prehandler }, async (req) => {
    const { depositoId, consumableId } = req.params as { depositoId: string; consumableId: string };
    const movements = await listarMovimentosConsumivel(depositoId, consumableId, req.authUser!.perfil);
    return { movements };
  });

  app.get('/deposits/:depositoId/ppe/:ppeItemId/movements', { preHandler: prehandler }, async (req) => {
    const { depositoId, ppeItemId } = req.params as { depositoId: string; ppeItemId: string };
    const movements = await listarMovimentosPpe(depositoId, ppeItemId, req.authUser!.perfil);
    return { movements };
  });

  app.get('/deposits/:depositoId/requests', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const { tipo } = req.query as { tipo?: string };
    const tipoValido = tipo === 'CONSUMIVEL' || tipo === 'EPI' ? (tipo as 'CONSUMIVEL' | 'EPI') : undefined;
    const solicitacoes = await listarSolicitacoes(
      depositoId,
      req.authUser!.perfil,
      req.authUser!.sub,
      tipoValido,
    );
    return { solicitacoes };
  });

  app.post(
    '/deposits/:depositoId/estoque/:tipo',
    {
      preHandler: prehandler,
      ...validateBody(estoqueItemCreateBodySchema),
    },
    async (req, reply) => {
      const body = req.body as typeof estoqueItemCreateBodySchema._type;
      const { depositoId, tipo } = req.params as { depositoId: string; tipo: string };
      if (tipo !== 'CONSUMIVEL' && tipo !== 'EPI') {
        reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'tipo deve ser CONSUMIVEL ou EPI' } });
        return;
      }
      const res = await estoqueService.criarItemEstoque(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          depositoId,
          tipo,
          codigo: body.codigo,
          descricao: body.descricao,
          unidade: body.unidade,
          estoqueMinimo: body.estoqueMinimo,
          assinaturaMatricula: body.assinaturaMatricula,
          matriculaConfirmacao: body.matriculaConfirmacao,
        },
      );
      return { item: { itemId: res.itemId, codigo: res.codigo, descricao: res.descricao } };
    },
  );

  app.put(
    '/deposits/:depositoId/estoque/:tipo/:itemId',
    {
      preHandler: prehandler,
      ...validateBody(estoqueItemUpdateBodySchema),
    },
    async (req, reply) => {
      const body = req.body as typeof estoqueItemUpdateBodySchema._type;
      const { depositoId, tipo, itemId } = req.params as { depositoId: string; tipo: string; itemId: string };
      if (tipo !== 'CONSUMIVEL' && tipo !== 'EPI') {
        reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'tipo deve ser CONSUMIVEL ou EPI' } });
        return;
      }
      const res = await estoqueService.editarItemEstoque(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          depositoId,
          tipo,
          itemId,
          codigo: body.codigo,
          descricao: body.descricao,
          unidade: body.unidade,
          estoqueMinimo: body.estoqueMinimo,
          assinaturaMatricula: body.assinaturaMatricula,
          matriculaConfirmacao: body.matriculaConfirmacao,
        },
      );
      return { item: { itemId: res.itemId, codigo: res.codigo, descricao: res.descricao } };
    },
  );

  app.post(
    '/deposits/:depositoId/estoque/:tipo/:itemId/excluir',
    {
      preHandler: [requireAcao('EXCLUIR_ITEM_ESTOQUE'), requireDepositoAcesso()],
      ...validateBody(estoqueExcluirBodySchema),
    },
    async (req, reply) => {
      const body = req.body as typeof estoqueExcluirBodySchema._type;
      const { depositoId, tipo, itemId } = req.params as { depositoId: string; tipo: string; itemId: string };
      if (tipo !== 'CONSUMIVEL' && tipo !== 'EPI') {
        reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'tipo deve ser CONSUMIVEL ou EPI' } });
        return;
      }
      const res = await estoqueService.excluirItemEstoque(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          tipo,
          itemId,
        },
      );
      return {
        excluido: true,
        itemId: res.itemId,
        codigo: res.codigo,
        movimentosExcluidos: res.movimentosExcluidos,
        solicitacoesExcluidas: res.solicitacoesExcluidas,
      };
    },
  );

  app.post(
    '/deposits/:depositoId/estoque/entrada',
    {
      preHandler: [requireAcao('ENTRADA_ESTOQUE'), requireDepositoAcesso()],
      ...validateBody(estoqueEntradaBodySchema),
    },
    async (req) => {
      const body = req.body as typeof estoqueEntradaBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await estoqueService.registrarEntradaEstoque(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          operationId: body.operationId,
          origem: body.origem,
        },
      );
      return {
        entrada: { itemId: res.itemId, codigo: res.codigo, saldo: res.saldo, criado: res.criado },
        criado: res.criado,
        saldo: res.saldo,
        jaProcessada: res.jaProcessada,
      };
    },
  );

  app.post(
    '/deposits/:depositoId/requests',
    {
      preHandler: prehandler,
      ...validateBody(solicitacaoCreateBodySchema),
    },
    async (req) => {
      const body = req.body as typeof solicitacaoCreateBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await requestService.registrarSolicitacao(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          operationId: body.operationId,
          enviar: body.enviar,
        },
      );
      return { solicitacao: res.solicitacao, jaProcessada: res.jaProcessada };
    },
  );

  app.post(
    '/deposits/:depositoId/requests/:requestId/transition',
    {
      preHandler: prehandler,
      ...validateBody(solicitacaoTransitionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof solicitacaoTransitionBodySchema._type;
      const { depositoId, requestId } = req.params as { depositoId: string; requestId: string };
      const res = await requestService.transicionarSolicitacaoService(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          requestId,
          operationId: body.operationId,
        },
      );
      return { solicitacao: res.solicitacao, jaProcessada: res.jaProcessada };
    },
  );
}