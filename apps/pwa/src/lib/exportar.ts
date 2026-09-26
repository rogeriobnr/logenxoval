import { jsPDF } from 'jspdf';
import type { RelatorioTabela, colunasTabela } from './relatorios';

export type PngCmd =
  | { tipo: 'ret'; x: number; y: number; w: number; h: number; cor: string }
  | { tipo: 'texto'; x: number; y: number; s: string; fonte: string; cor: string; alinhar: 'left' | 'right' };

export interface LayoutPng {
  largura: number;
  altura: number;
  comandos: PngCmd[];
}

const MARGEM = 14;
const LINHA = 7.5;
const CABECALHO_Y = 34;

function fontSize(titulo: boolean): string {
  return titulo ? 'bold 14px sans-serif' : '11px sans-serif';
}

/** Layout puro (testável sem canvas): título, cabeçalho e linhas paginadas. */
export function layoutPng(tab: RelatorioTabela): LayoutPng {
  const larguraTabela = 272; // mm-ish em pt-equivalente (unidades canvas)
  const colunas = tab.colunas;
  const comandos: PngCmd[] = [];
  let y = 16;
  comandos.push({ tipo: 'texto', x: 0, y, s: tab.titulo, fonte: fontSize(true), cor: '#111', alinhar: 'left' });
  y += 10;
  comandos.push({ tipo: 'texto', x: 0, y, s: tab.subtitulo, fonte: fontSize(false), cor: '#333', alinhar: 'left' });
  y += 8;

  const larguras = colunas.map((c) => Math.round((c.largura / 100) * larguraTabela));
  const paginar = (linhas: string[][], ini: number): number => {
    let x = 0;
    for (let c = 0; c < colunas.length; c++) {
      comandos.push({
        tipo: 'ret',
        x,
        y: ini - LINHA + 1,
        w: larguras[c],
        h: LINHA - 1,
        cor: c % 2 === 0 ? '#eef1f4' : '#f7f9fb',
      });
      comandos.push({ tipo: 'texto', x: x + 3, y: ini, s: colunas[c].titulo, fonte: 'bold 10px sans-serif', cor: '#222', alinhar: 'left' });
      x += larguras[c];
    }
    y = ini + 4;
    for (const linha of linhas) {
      if (y >= 200) {
        y = CABECALHO_Y;
        for (let c = 0; c < colunas.length; c++) {
          comandos.push({ tipo: 'ret', x: c === 0 ? 0 : larguras.slice(0, c).reduce((a, b) => a + b, 0), y: y - LINHA + 1, w: larguras[c], h: LINHA - 1, cor: c % 2 === 0 ? '#eef1f4' : '#f7f9fb' });
          comandos.push({ tipo: 'texto', x: (c === 0 ? 0 : larguras.slice(0, c).reduce((a, b) => a + b, 0)) + 3, y, s: colunas[c].titulo, fonte: 'bold 10px sans-serif', cor: '#222', alinhar: 'left' });
        }
        y += 4;
      }
      let x2 = 0;
      for (let c = 0; c < colunas.length; c++) {
        comandos.push({ tipo: 'texto', x: x2 + 3, y, s: linha[c] ?? '', fonte: '11px sans-serif', cor: '#222', alinhar: 'left' });
        x2 += larguras[c];
      }
      y += LINHA;
    }
    return y;
  };

  const fim = paginar(tab.linhas, y);
  if (tab.rodape) {
    y = fim + 6;
    comandos.push({ tipo: 'texto', x: 0, y, s: tab.rodape, fonte: 'italic 10px sans-serif', cor: '#333', alinhar: 'left' });
    y += 8;
  }

  return {
    largura: larguraTabela,
    altura: Math.max(y + MARGEM, 220),
    comandos,
  };
}

/** Gera PDF via jsPDF diretamente do layout da tabela (funciona em Node e browser). */
export function gerarPdf(tab: RelatorioTabela): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraUteis = doc.internal.pageSize.getWidth() - 2 * MARGEM;
  const colunas: colunasTabela[] = tab.colunas;
  const larguras = colunas.map((c) => (c.largura / 100) * larguraUteis);

  const cabecalho = (n: number) => {
    let x = MARGEM;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(34, 34, 34);
    for (let c = 0; c < colunas.length; c++) {
      doc.rect(x, n - 6, larguras[c], 6, 'F');
      doc.text(colunas[c].titulo, x + 1.5, n);
      x += larguras[c];
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(17, 17, 17);
  doc.text(tab.titulo, MARGEM, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(tab.subtitulo, MARGEM, 22);

  let y = 34;
  cabecalho(y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(34, 34, 34);
  for (const linha of tab.linhas) {
    if (y > 280) {
      doc.addPage();
      y = 34;
      cabecalho(y);
      y += 4;
    }
    let x = MARGEM;
    for (let c = 0; c < colunas.length; c++) {
      doc.text(linha[c] ?? '', x + 1.5, y);
      doc.setDrawColor(220, 224, 228);
      doc.line(MARGEM, y + 1.2, MARGEM + larguraUteis, y + 1.2);
      x += larguras[c];
    }
    y += 5.2;
  }
  if (tab.rodape) {
    if (y > 285) {
      doc.addPage();
      y = 34;
      cabecalho(y);
      y += 4;
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(tab.rodape, MARGEM, y + 2);
  }

  return doc;
}

/** Gera arquivo PNG (browser): desenha o layout num canvas e devolve dataURL. */
export function gerarPngDataUrl(tab: RelatorioTabela, escala = 2): string {
  const layout = layoutPng(tab);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(layout.largura * escala);
  canvas.height = Math.ceil(layout.altura * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  ctx.scale(escala, escala);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.largura, layout.altura);
  for (const cmd of layout.comandos) {
    if (cmd.tipo === 'ret') {
      ctx.fillStyle = cmd.cor;
      ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
    } else {
      ctx.font = cmd.fonte;
      ctx.fillStyle = cmd.cor;
      ctx.textAlign = cmd.alinhar === 'right' ? 'right' : 'left';
      ctx.fillText(cmd.s, cmd.x, cmd.y);
    }
  }
  return canvas.toDataURL('image/png');
}

export function baixarArquivo(data: BlobPart, nome: string, tipo: string): void {
  const blob = new Blob([data], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

interface FileSystemWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<FileSystemWritable>;
}

type ArquivoSalvo = 'salvo' | 'download' | 'cancelado';

export function temDialogoDeArquivos(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export function podeCompartilharArquivos(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

/**
 * Salva com caixa de diálogo nativa (File System Access API) quando disponível;
 * senão baixa direto. Devolve como o arquivo foi entregue ao usuário.
 */
export async function salvarComDialogoOuDownload(blob: Blob, nome: string, tipo: string): Promise<ArquivoSalvo> {
  if (temDialogoDeArquivos()) {
    try {
      const ext = nome.includes('.') ? nome.slice(nome.lastIndexOf('.') + 1).toLowerCase() : 'lxb';
      const picker = (window as unknown as { showSaveFilePicker: (o?: SaveFilePickerOptions) => Promise<SaveFileHandle> }).showSaveFilePicker;
      const handle = await picker({
        suggestedName: nome,
        types: [{ description: 'Backup LogEnxoval', accept: { [tipo]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'salvo';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelado';
      // falha do seletor → cai no download simples
    }
  }
  baixarArquivo(blob, nome, tipo);
  return 'download';
}

/** Compartilha o arquivo pelo sistema (Web Share API). Retorna false se indisponível/cancelado. */
export async function compartilharArquivo(blob: Blob, nome: string): Promise<boolean> {
  if (!podeCompartilharArquivos() || typeof File === 'undefined') return false;
  try {
    const arquivo = new File([blob], nome, { type: blob.type });
    if (!navigator.canShare({ files: [arquivo] })) return false;
    await navigator.share({ files: [arquivo] });
    return true;
  } catch {
    return false;
  }
}

export function baixarPdf(tab: RelatorioTabela, nome: string): void {
  const doc = gerarPdf(tab);
  doc.save(nome);
}

export function baixarPng(tab: RelatorioTabela, nome: string): void {
  const dataUrl = gerarPngDataUrl(tab);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = nome;
  a.click();
}

export function baixarJson(objeto: unknown, nome: string): void {
  baixarArquivo(JSON.stringify(objeto, null, 2), nome, 'application/json');
}

export function baixarMarkdown(md: string, nome: string): void {
  baixarArquivo(md, nome, 'text/markdown;charset=utf-8');
}