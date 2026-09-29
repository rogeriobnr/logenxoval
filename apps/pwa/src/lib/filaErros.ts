import type { SyncQueueRow } from '@logenxoval/contracts';

export const ENTIDADE_FILA_LABEL: Record<string, string> = {
  BAIXA: 'Baixa de Goldbox',
  ENTRADA_MATERIAL: 'Entrada de material',
  DOCUMENTO: 'Foto de documento',
  SPARE_PART_ENTRADA: 'Entrada de peça avulsa',
  SPARE_PART_SAIDA: 'Saída de peça avulsa',
  SUGESTAO_ACEITA: 'Sugestão aceita',
  SUGESTAO_RECUSADA: 'Sugestão recusada',
  ENTRADA_ESTOQUE: 'Entrada de consumível/EPI',
  SOLICITACAO: 'Solicitação de consumível/EPI',
  SOLICITACAO_TRANSICAO: 'Situação da solicitação',
};

/** Descrição curta do que a operação tenta fazer, para a tela de erros. */
export function resumoOperacaoFila(q: SyncQueueRow): string {
  const p = (q.payload ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const itens = Array.isArray(p.itens) ? (p.itens as Array<{ codigo?: string; qtd?: number }>) : [];
  const codigos = itens
    .map((i) => `${num(i.qtd)}x ${num(i.codigo)}`.trim())
    .filter(Boolean)
    .join(', ');
  if (q.entidade === 'BAIXA') return `${num(p.codigoSap)} · ${num(p.quantidade)} un.`;
  if (q.entidade === 'ENTRADA_MATERIAL') return `${num(p.codigoSap)} · ${num(p.quantidade)} un.`;
  if (q.entidade === 'SPARE_PART_ENTRADA' || q.entidade === 'SPARE_PART_SAIDA')
    return `${num(p.codigo)} · ${num(p.quantidade)} un.`;
  if (q.entidade === 'DOCUMENTO') return num(p.titulo) || 'Documento';
  if (q.entidade === 'ENTRADA_ESTOQUE') return `${num(p.codigo)} · +${num(p.quantidade)}`;
  if (q.entidade === 'SOLICITACAO') return codigos || 'Solicitação';
  if (q.entidade === 'SOLICITACAO_TRANSICAO') return `Situação → ${num(p.para)}`;
  if (q.entidade === 'SUGESTAO_ACEITA' || q.entidade === 'SUGESTAO_RECUSADA') return num(p.motivo) || 'Sugestão';
  return codigos || 'Operação';
}

export interface DicaErro {
  titulo: string;
  orientacao: string;
}

/**
 * Traduz o erro do servidor em ação prática. O usuário precisa saber se basta
 * tentar de novo, se precisa corrigir dado no app ou se deve descartar.
 */
export function orientacaoParaErro(erro: string | undefined): DicaErro {
  const e = (erro ?? '').toLowerCase();
  if (!e) {
    return {
      titulo: 'Erro sem detalhe',
      orientacao: 'Reenvie a operação. Se repetir, descarte e refaça o registro no app.',
    };
  }
  if (e.includes('matrícula') || e.includes('matricula')) {
    return {
      titulo: 'Confirmação de matrícula não conferiu',
      orientacao: 'Refaça o registro e confirme a matrícula de novo. Reenviar sem corrigir falha novamente.',
    };
  }
  if (e.includes('pin')) {
    return {
      titulo: 'PIN exigido nesta operação',
      orientacao: 'Se você esqueceu o PIN, use “Acesso → Esqueci meu PIN”. Depois reenvie a operação.',
    };
  }
  if (e.includes('saldo') || e.includes('estoque insuficiente') || e.includes('negativ')) {
    return {
      titulo: 'Saldo insuficiente no servidor',
      orientacao: 'Registre a entrada no Goldbox ou descarte a operação para não repetir o erro.',
    };
  }
  if (e.includes('não encontrada') || e.includes('nao encontrada') || e.includes('não existe')) {
    return {
      titulo: 'Registro não existe mais no servidor',
      orientacao: 'O item foi excluído ou alterado por outra pessoa. Descarte a operação.',
    };
  }
  if (e.includes('conflito') || e.includes('duplicad') || e.includes('código já existe') || e.includes('codigo ja existe')) {
    return {
      titulo: 'Conflito com o que já está no servidor',
      orientacao: 'O registro já foi feito em outro aparelho. Confira e descarte para não duplicar.',
    };
  }
  if (e.includes('sem permissão') || e.includes('permissão') || e.includes('permissao') || e.includes('403')) {
    return {
      titulo: 'Seu perfil não permite esta operação',
      orientacao: 'Peça ao líder para executar, ou descarte a operação.',
    };
  }
  if (e.includes('depósito inativo') || e.includes('deposito inativo') || e.includes('inativo')) {
    return {
      titulo: 'Depósito inativo',
      orientacao: 'Reative o depósito no servidor antes de reenviar.',
    };
  }
  if (e.includes('rede') || e.includes('conexão') || e.includes('conexao') || e.includes('timeout') || e.includes('fetch')) {
    return {
      titulo: 'Falha de comunicação',
      orientacao: 'É transitório: reconecte e use “Sincronizar agora” para reenviar.',
    };
  }
  return {
    titulo: 'O servidor recusou a operação',
    orientacao: 'Reenvie depois de revisar os dados. Se persistir, descarte e refaça pelo app.',
  };
}
