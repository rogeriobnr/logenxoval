import type { Perfil } from '@logenxoval/contracts';

export type Acao =
  | 'BAIXA'
  | 'CONFERENCIA'
  | 'CORRECAO'
  | 'ESTORNO'
  | 'CRIAR_DEPOSITO'
  | 'EDITAR_DEPOSITO'
  | 'DESATIVAR_DEPOSITO'
  | 'IMPORTAR_ENXOVAL'
  | 'PUBLICAR_ENXOVAL'
  | 'RESTAURAR'
  | 'DESATIVAR_ITEM'
  | 'AJUSTE_AUTORIZADO'
  | 'DESCARTE'
  | 'APROVAR_SOLICITACAO'
  | 'GERENCIAR_USUARIOS'
  | 'CONFIGURACOES'
  | 'CONVERTER_SUGESTAO';

export const ACTION_REQUIRES_MATRICULA = new Set<Acao>([
  'BAIXA',
  'CONFERENCIA',
  'CORRECAO',
  'ESTORNO',
  'IMPORTAR_ENXOVAL',
  'PUBLICAR_ENXOVAL',
  'RESTAURAR',
  'CONVERTER_SUGESTAO',
]);

export const ACTION_REQUIRES_PIN = new Set<Acao>([
  'ESTORNO',
  'CRIAR_DEPOSITO',
  'EDITAR_DEPOSITO',
  'DESATIVAR_DEPOSITO',
  'IMPORTAR_ENXOVAL',
  'PUBLICAR_ENXOVAL',
  'RESTAURAR',
  'DESATIVAR_ITEM',
  'AJUSTE_AUTORIZADO',
  'DESCARTE',
  'APROVAR_SOLICITACAO',
  'GERENCIAR_USUARIOS',
  'CONFIGURACOES',
]);

const PERMISSOES: Record<Perfil, Record<Acao, boolean>> = {
  MECANICO: {
    BAIXA: true,
    CONFERENCIA: true,
    CORRECAO: true,
    ESTORNO: false,
    CRIAR_DEPOSITO: false,
    EDITAR_DEPOSITO: false,
    DESATIVAR_DEPOSITO: false,
    IMPORTAR_ENXOVAL: false,
    PUBLICAR_ENXOVAL: false,
    RESTAURAR: false,
    DESATIVAR_ITEM: false,
    AJUSTE_AUTORIZADO: false,
    DESCARTE: false,
    APROVAR_SOLICITACAO: false,
    GERENCIAR_USUARIOS: false,
    CONFIGURACOES: false,
    CONVERTER_SUGESTAO: false,
  },
  LIDER: {
    BAIXA: true,
    CONFERENCIA: true,
    CORRECAO: true,
    ESTORNO: true,
    CRIAR_DEPOSITO: true,
    EDITAR_DEPOSITO: true,
    DESATIVAR_DEPOSITO: true,
    IMPORTAR_ENXOVAL: true,
    PUBLICAR_ENXOVAL: true,
    RESTAURAR: true,
    DESATIVAR_ITEM: true,
    AJUSTE_AUTORIZADO: true,
    DESCARTE: true,
    APROVAR_SOLICITACAO: true,
    GERENCIAR_USUARIOS: false,
    CONFIGURACOES: true,
    CONVERTER_SUGESTAO: true,
  },
  ADMIN: {
    BAIXA: true,
    CONFERENCIA: true,
    CORRECAO: true,
    ESTORNO: true,
    CRIAR_DEPOSITO: true,
    EDITAR_DEPOSITO: true,
    DESATIVAR_DEPOSITO: true,
    IMPORTAR_ENXOVAL: true,
    PUBLICAR_ENXOVAL: true,
    RESTAURAR: true,
    DESATIVAR_ITEM: true,
    AJUSTE_AUTORIZADO: true,
    DESCARTE: true,
    APROVAR_SOLICITACAO: true,
    GERENCIAR_USUARIOS: true,
    CONFIGURACOES: true,
    CONVERTER_SUGESTAO: true,
  },
};

export function podeExecutar(perfil: Perfil, acao: Acao): boolean {
  return PERMISSOES[perfil]?.[acao] ?? false;
}

export function acaoRequerMatricula(acao: Acao): boolean {
  return ACTION_REQUIRES_MATRICULA.has(acao);
}

export function acaoRequerPin(acao: Acao): boolean {
  return ACTION_REQUIRES_PIN.has(acao);
}