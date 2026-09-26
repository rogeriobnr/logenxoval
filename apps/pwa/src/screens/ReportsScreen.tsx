import { useCallback, useState } from 'react';
import type {
  AuditLogRow,
  ConsumableRow,
  DivergenceRow,
  GoldboxMovementRow,
  InventoryItemRow,
  RequestRow,
} from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Btn, Field, SelectField } from '../components/ui';
import { useToast } from '../components/Toasts';
import { FiltroRelatorio, RelatorioTabela } from '../lib/relatorios';
import {
  relatorioAuditLogs,
  relatorioConferencias,
  relatorioConsumiveis,
  relatorioDivergencias,
  relatorioEnxoval,
  relatorioMovimentacoes,
  relatorioSolicitacoes,
} from '../lib/relatorios';
import { baixarJson, baixarPdf, baixarPng } from '../lib/exportar';
import {
  getEnxovalAtualLocal,
  listAuditLogsLocal,
  getDepositoLocal,
  listConsumiveisLocal,
  listDivergenciasAbertas,
  listMovimentosLocais,
  listPpeLocal,
  listRequestsLocal,
} from '../repos/local';

type TipoRelatorio =
  | 'enxoval'
  | 'movimentacoes'
  | 'consumiveis'
  | 'epis'
  | 'solicitacoes'
  | 'auditoria'
  | 'conferencias'
  | 'divergencias';

const TIPOS: Array<{ valor: TipoRelatorio; label: string }> = [
  { valor: 'enxoval', label: 'Enxoval atual' },
  { valor: 'movimentacoes', label: 'Movimentações' },
  { valor: 'consumiveis', label: 'Consumíveis' },
  { valor: 'epis', label: 'EPIs' },
  { valor: 'solicitacoes', label: 'Solicitações' },
  { valor: 'auditoria', label: 'Log de auditoria' },
  { valor: 'conferencias', label: 'Conferências' },
  { valor: 'divergencias', label: 'Divergências' },
];

function baixarNome(base: string, ext: string): string {
  const d = new Date();
  return `${base}-${d.toISOString().slice(0, 10)}.${ext}`;
}

export function ReportsScreen() {
  const { session } = useAuth();
  const toast = useToast();
  const [tipo, setTipo] = useState<TipoRelatorio>('enxoval');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async (): Promise<RelatorioTabela> => {
    const depositoId = session?.depositoAtivo?.id ?? '';
    const dep = await getDepositoLocal(depositoId);
    const nome = dep?.nome ?? session?.depositoAtivo?.nome ?? 'Depósito';
    const numero = dep?.numero ?? '';
    const filtro: FiltroRelatorio = {};
    if (dataIni) filtro.dataIni = new Date(`${dataIni}T00:00:00`).toISOString();
    if (dataFim) filtro.dataFim = new Date(`${dataFim}T00:00:00`).toISOString();
    if (codigo.trim()) filtro.codigo = codigo.trim();

    switch (tipo) {
      case 'enxoval': {
        const { versao, itens } = await getEnxovalAtualLocal(depositoId);
        return relatorioEnxoval(itens as InventoryItemRow[], nome, numero, versao?.versao?.toString() ?? versao?.id);
      }
      case 'movimentacoes': {
        const mov = await listMovimentosLocais(depositoId);
        return relatorioMovimentacoes(mov as GoldboxMovementRow[], nome, numero, filtro);
      }
      case 'consumiveis': {
        const c = await listConsumiveisLocal(depositoId);
        return relatorioConsumiveis(c as ConsumableRow[], nome, numero);
      }
      case 'epis': {
        const p = await listPpeLocal(depositoId);
        return relatorioConsumiveis(p as unknown as ConsumableRow[], nome, numero, 'EPIs');
      }
      case 'solicitacoes': {
        const r = await listRequestsLocal(depositoId);
        return relatorioSolicitacoes(r as RequestRow[], nome, numero, filtro);
      }
      case 'auditoria': {
        const l = await listAuditLogsLocal(depositoId);
        return relatorioAuditLogs(l as AuditLogRow[], nome, numero, filtro);
      }
      case 'conferencias':
        return relatorioConferencias([], nome, numero, filtro);
      case 'divergencias': {
        const d = await listDivergenciasAbertas(depositoId);
        return relatorioDivergencias(d as DivergenceRow[], nome, numero, filtro);
      }
    }
  }, [session, tipo, dataIni, dataFim, codigo]);

  const exportar = async (formato: 'pdf' | 'png' | 'json') => {
    setBusy(true);
    try {
      const tab = await carregar();
      const nome = baixarNome(`relatorio-${tipo}`, formato);
      if (formato === 'pdf') baixarPdf(tab, nome);
      else if (formato === 'png') baixarPng(tab, nome);
      else baixarJson(tab, nome);
      toast.success('Relatório gerado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar relatório');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Relatórios</h3>
        <div className="list-sub" style={{ marginBottom: '0.6rem' }}>
          Gerados localmente no aparelho (PDF/PNG/JSON), sem necessidade de conexão.
        </div>
        <SelectField
          id="rel-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoRelatorio)}
        >
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.label}
            </option>
          ))}
        </SelectField>
        {tipo === 'movimentacoes' || tipo === 'solicitacoes' || tipo === 'auditoria' || tipo === 'conferencias' || tipo === 'divergencias' ? (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <Field id="rel-data-ini" label="De" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            <Field id="rel-data-fim" label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        ) : null}
        {(tipo === 'movimentacoes' || tipo === 'auditoria' || tipo === 'divergencias') ? (
          <Field
            id="rel-codigo"
            label="Buscar (SAP / matrícula / texto)"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Opcional"
          />
        ) : null}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
          <Btn onClick={() => void exportar('pdf')} disabled={busy}>Baixar PDF</Btn>
          <Btn variant="secondary" onClick={() => void exportar('png')} disabled={busy}>Baixar PNG</Btn>
          <Btn variant="ghost" onClick={() => void exportar('json')} disabled={busy}>JSON</Btn>
        </div>
      </div>
    </div>
  );
}