import { useCallback, useEffect, useState } from 'react';
import type { AuditLogRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import {
  filtrarLogs,
  formatarDataHora,
  GRUPO_LABEL,
  GRUPO_MARCA,
  grupoDeLog,
  LOG_TIPO_LABEL,
  malhaDoMes,
  resumirMes,
  type LogGrupo,
} from '../lib/logs';
import { listAuditLogsLocal } from '../repos/local';
import { espelharLogs } from '../services/sync';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DIAS_SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const GRUPOS: LogGrupo[] = ['peca', 'reposicao', 'lideranca', 'divergencia', 'conferencia'];

export function LogsScreen() {
  const { api, session, online } = useAuth();
  const depositoId = session?.depositoAtivo?.id ?? '';

  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<LogGrupo | null>(null);
  const [matricula, setMatricula] = useState('');
  const [logs, setLogs] = useState<AuditLogRow[]>([]);

  const recarregar = useCallback(async () => {
    if (!depositoId) return;
    if (online) {
      try {
        await espelharLogs(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    setLogs(await listAuditLogsLocal(depositoId));
  }, [api, depositoId, online]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para consultar os logs.</Alert>;
  }

  const filtrados = filtrarLogs(logs, { grupo: grupo ?? undefined, matricula: matricula.trim() || undefined });

  const marcasDoMes = resumirMes(filtrados);
  const chaveMes = `${ano}-${String(mes + 1).padStart(2, '0')}`;
  const resumoDia = diaSelecionado ? marcasDoMes.get(diaSelecionado) : undefined;

  const timeline = diaSelecionado
    ? filtrados
        .filter((l) => l.dataHora.slice(0, 10) === diaSelecionado)
        .sort((a, b) => b.dataHora.localeCompare(a.dataHora))
    : filtrados
        .filter((l) => l.dataHora.startsWith(chaveMes))
        .slice(0, 120);

  const nav = (delta: number) => {
    const novo = new Date(ano, mes + delta, 1);
    setAno(novo.getFullYear());
    setMes(novo.getMonth());
    setDiaSelecionado(null);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">Logs · {session.depositoAtivo.nome}</div>
            <div className="list-sub">Calendário de auditoria — {logs.length} registro(s) no espelho local</div>
          </div>
          <div style={{ width: '11rem' }}>
            <Field id="lg-matricula" label="Matrícula" placeholder="Filtrar por usuário" value={matricula}
              onChange={(e) => { setMatricula(e.target.value); setDiaSelecionado(null); }} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ gap: '0.5rem' }}>
          <Btn variant="secondary" className="small" onClick={() => nav(-1)}>◀</Btn>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>
            {MESES[mes]} {ano}
          </div>
          <Btn variant="secondary" className="small" onClick={() => nav(1)}>▶</Btn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.2rem', marginTop: '0.4rem' }}>
          {DIAS_SEMANA.map((d, i) => (
            <div key={i} className="list-sub" style={{ textAlign: 'center' }}>{d}</div>
          ))}
          {malhaDoMes(ano, mes).map((c, i) => {
            if (!c.iso) return <div key={i} />;
            const resumo = marcasDoMes.get(c.iso);
            const selecionado = diaSelecionado === c.iso;
            return (
              <button
                key={i}
                className="chip"
                style={{
                  padding: '0.35rem 0',
                  textAlign: 'center',
                  border: selecionado ? '1px solid var(--primary, #999)' : '1px solid var(--line)',
                  background: selecionado ? 'var(--line, #ddd)' : 'transparent',
                }}
                onClick={() => setDiaSelecionado(selecionado ? null : c.iso!)}
              >
                {c.dia}
                {resumo && (
                  <div style={{ fontSize: '0.7rem', lineHeight: 1 }}>
                    {resumo.marcas.join('')}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Legenda</h3>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {GRUPOS.map((g) => (
            <Btn key={g} variant={grupo === g ? 'primary' : 'ghost'} className="small" onClick={() => setGrupo(grupo === g ? null : g)}>
              {GRUPO_MARCA[g]} {GRUPO_LABEL[g]}
            </Btn>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>
          {diaSelecionado
            ? `Eventos de ${diaSelecionado.slice(8, 10)}/${diaSelecionado.slice(5, 7)}`
            : `Timeline · ${MESES[mes]} ${ano}`}
        </h3>
        {resumoDia && diaSelecionado && (
          <div className="list-sub">{resumoDia.marcas.join(' ')} {resumoDia.total} evento(s)</div>
        )}
        <div style={{ marginTop: '0.6rem' }}>
          {timeline.length === 0 && <div className="list-sub">Nenhum evento neste período.</div>}
          {timeline.map((l) => {
            const { data, hora } = formatarDataHora(l.dataHora);
            return (
              <div key={l.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="list-sub" style={{ minWidth: '5.2rem', textAlign: 'right' }}>
                  {data} {hora}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="list-title">{LOG_TIPO_LABEL[l.tipo]}</div>
                  <div className="list-sub">{l.matricula}{l.motivo ? ` · ${l.motivo}` : ''}</div>
                </div>
                <div style={{ fontSize: '1rem' }}>{GRUPO_MARCA[grupoDeLog(l.tipo)]}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}