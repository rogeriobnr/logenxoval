import type { InventoryItemRow, OCR_CONFIANCA } from '@logenxoval/contracts';

export type OcrConfianca = (typeof OCR_CONFIANCA)[keyof typeof OCR_CONFIANCA];

export interface LinhaOcr {
  linha: number;
  codigoSap: string;
  textoBreve: string;
  quantidade?: number;
  unidadeMedida?: string;
  confiancaCodigo: OcrConfianca;
  confiancaQtd: OcrConfianca;
}

export const OCR_CONFIANCA_LABEL: Record<OcrConfianca, string> = {
  ALTA: 'Reconhecido e validado',
  BAIXA: 'Baixa confiança — confira',
  AUSENTE: 'Campo ausente',
  INVALIDO: 'Valor inválido',
};

const SAP_PATTERN = /\b\d{6,8}\b/;

/**
 * Extrai linhas da folha a partir do texto bruto do OCR. Cada linha textual é
 * analisada buscando: código SAP (6 a 8 dígitos), quantidade (número isolado no
 * fim) e o texto breve restante. Confiança ALTA quando SAP válido e qtd presente;
 * senão BAIXA/AUSENTE para revisão manual (docs 6.4).
 */
export function extrairLinhas(texto: string): LinhaOcr[] {
  return texto
    .split(/\r?\n/)
    .map((linha, i): LinhaOcr | null => {
      const limpa = linha.trim();
      if (!limpa) return null;
      const sap = SAP_PATTERN.exec(limpa);
      const codigoSap = sap?.[0] ?? '';
      const antes = limpa.slice(0, sap?.index ?? limpa.length);
      const depois = sap ? limpa.slice((sap?.index ?? 0) + sap[0].length) : limpa;
      const partesNum = (antes.length > 0 ? antes : depois).split(/\s+/).filter(Boolean);
      const quantidade = partesNum.length > 0 && /^\d+$/.test(partesNum[partesNum.length - 1])
        ? Number(partesNum[partesNum.length - 1])
        : undefined;
      const textoBreve = (antes.length > 0 ? antes : depois)
        .replace(/\b\d+\b\s*$/, '')
        .replace(/\s*\|\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '';

      const confiancaCodigo: OcrConfianca = codigoSap ? 'ALTA' : quantidade !== undefined ? 'BAIXA' : 'AUSENTE';
      const confiancaQtd: OcrConfianca =
        quantidade === undefined ? 'AUSENTE' : codigoSap ? 'ALTA' : 'BAIXA';
      return { linha: i, codigoSap, textoBreve, quantidade, confiancaCodigo, confiancaQtd };
    })
    .filter((l): l is LinhaOcr => l !== null);
}

export interface ItemRevisao extends LinhaOcr {
  id: string;
  ehNovo: boolean;
  duplicado: boolean;
  qtdListaAtual?: number;
  descricaoListaAtual?: string;
}

export interface ComparacaoVersao {
  novos: number;
  removidos: number;
  qtdAlterados: number;
  descAlterados: number;
  semAlteracao: number;
  duplicados: number;
  invalidos: number;
}

export interface RevisaoResultado {
  linhas: ItemRevisao[];
  comparacao: ComparacaoVersao;
}

/**
 * Monta a grade de revisão comparando as linhas reconhecidas com a versão atual
 * (docs 6.5). Itens novos/alterados são sinalizados em azul; duplicados e
 * códigos inválidos contabilizados.
 */
export function revisarLinhas(
  linhas: LinhaOcr[],
  itensAtuais: InventoryItemRow[],
): RevisaoResultado {
  const porSap = new Map(itensAtuais.map((i) => [i.codigoSap, i]));
  const vistos = new Map<string, number>();

  const linhasRevisadas: ItemRevisao[] = linhas.map((l) => {
    const ocorrencias = (vistos.get(l.codigoSap) ?? 0) + 1;
    vistos.set(l.codigoSap, ocorrencias);
    const atual = l.codigoSap ? porSap.get(l.codigoSap) : undefined;
    return {
      ...l,
      id: `linha-${l.linha}`,
      ehNovo: Boolean(l.codigoSap && !atual),
      duplicado: ocorrencias > 1,
      qtdListaAtual: atual?.qtdOficial,
      descricaoListaAtual: atual?.textoBreve,
    };
  });

  const sapsLinha = new Set(linhas.map((l) => l.codigoSap).filter(Boolean));
  const sapsAtuais = new Set(itensAtuais.map((i) => i.codigoSap));

  const comparacao: ComparacaoVersao = {
    novos: linhasRevisadas.filter((l) => l.ehNovo).length,
    removidos: [...sapsAtuais].filter((s) => !sapsLinha.has(s)).length,
    qtdAlterados: linhasRevisadas.filter(
      (l) => !l.ehNovo && l.qtdListaAtual !== undefined && l.quantidade !== undefined && l.quantidade !== l.qtdListaAtual,
    ).length,
    descAlterados: linhasRevisadas.filter(
      (l) =>
        !l.ehNovo &&
        l.descricaoListaAtual !== undefined &&
        l.textoBreve &&
        l.textoBreve.toLowerCase() !== l.descricaoListaAtual.toLowerCase(),
    ).length,
    semAlteracao: linhasRevisadas.filter(
      (l) =>
        !l.ehNovo &&
        l.qtdListaAtual !== undefined &&
        l.quantidade !== undefined &&
        l.quantidade === l.qtdListaAtual &&
        l.textoBreve.toLowerCase() === (l.descricaoListaAtual ?? '').toLowerCase(),
    ).length,
    duplicados: linhasRevisadas.filter((l) => l.duplicado).length,
    invalidos: linhasRevisadas.filter((l) => !l.codigoSap || l.confiancaCodigo === 'INVALIDO').length,
  };

  return { linhas: linhasRevisadas, comparacao };
}

export interface ItemPublicavel {
  codigoSap: string;
  textoBreve: string;
  qtdOficial: number;
  qtdAtual: number;
  utilizacaoLivre: boolean;
  unidadeMedida?: string;
}

/** Converte a grade revisada em itens prontos para `POST /enxoval/import`. */
export function itensParaPublicacao(linhas: ItemRevisao[]): ItemPublicavel[] {
  return linhas
    .filter((l) => l.codigoSap.trim() && l.textoBreve.trim())
    .map((l) => ({
      codigoSap: l.codigoSap.trim(),
      textoBreve: l.textoBreve.trim(),
      qtdOficial: l.quantidade ?? 0,
      qtdAtual: l.quantidade ?? 0,
      utilizacaoLivre: true,
      unidadeMedida: l.unidadeMedida || undefined,
    }));
}

export function confiancaDoCampo(confianca: OcrConfianca): 'ok' | 'warn' | 'err' {
  if (confianca === 'ALTA') return 'ok';
  if (confianca === 'BAIXA') return 'warn';
  return 'err';
}

/**
 * Executa o OCR localmente (Tesseract.js) sobre o arquivo capturado.
 * Requer conexão apenas para baixar o modelo treinado em primeiro uso.
 */
export async function reconhecerDocumento(file: File | Blob, lang = 'por'): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(lang);
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export function tamanhoDeDocumento(file: File): { tamanho: number; mime: string; tipo: 'FOTO' | 'PDF' } {
  const mime = file.type || 'application/octet-stream';
  const tipo = file.type === 'application/pdf' ? 'PDF' : 'FOTO';
  return { tamanho: file.size, mime, tipo };
}