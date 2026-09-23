/**
 * Parse de linhas de importação do enxoval (fase 03).
 * Formato por linha: `codigoSap|textoBreve|qtdOficial|unidade(opcional)`.
 */
export interface LinhaEnxoval {
  codigoSap: string;
  textoBreve: string;
  qtdOficial: number;
  unidadeMedida?: string;
}

export interface ParseEnxovalResult {
  itens: LinhaEnxoval[];
  erros: string[];
}

export function parseLinhasEnxoval(text: string): ParseEnxovalResult {
  const linhas = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const itens: LinhaEnxoval[] = [];
  const erros: string[] = [];

  linhas.forEach((linha, idx) => {
    const partes = linha.split('|').map((p) => p.trim());
    const [codigoSap, textoBreve, qtdStr, unidade] = partes;
    const numero = idx + 1;

    if (partes.length < 3 || !codigoSap || !textoBreve) {
      erros.push(`Linha ${numero}: esperado codigoSap|textoBreve|qtdOficial[|unidade]`);
      return;
    }
    const qtd = Number(qtdStr.replace(',', '.'));
    if (!Number.isInteger(qtd) || qtd < 0) {
      erros.push(`Linha ${numero}: quantidade inválida ('${qtdStr}')`);
      return;
    }
    itens.push({
      codigoSap,
      textoBreve,
      qtdOficial: qtd,
      unidadeMedida: unidade || undefined,
    });
  });

  return { itens, erros };
}