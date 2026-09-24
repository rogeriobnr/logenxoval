import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  InspectionItemRow,
  InspectionRow,
  InventoryItemRow,
  SparePartRow,
  TipoCorrecao,
} from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field, SelectField } from '../components/ui';
import { assinarMatricula } from '../lib/assinatura';
import { resumoDeItens, statusDeItem, TIPO_CORRECAO_LABEL, INSPECAO_STATUS_LABEL } from '../lib/conferencia';
import { listInventoryItemsLocal } from '../repos/local';
import { espelharEnxoval } from '../services/sync';

type Tab = 'contar' | 'historico';

interface InspecaoLista extends InspectionRow {
  totalItens: number;
  divergentes: number;
}

interface ConferenciaDetalhe {
  inspecao: InspectionRow;
  itens: Array<InspectionItemRow & { sparePartDisponivel?: number }>;
}

const TIPOS: TipoCorrecao[] = [
  'APENAS_REGISTRAR_DIVERGENCIA',
  'CORRIGIR_COM_PECA_AVULSA',
  'AGUARDAR_REPOSICAO',
  'ACAO_LIDERANCA',
  'OUTRA',
];

function agora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ConferenciaScreen() {
  const { api, session } = useAuth();
  const [tab, setTab] = useState<Tab>('contar');

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const podeEstornar = perfil === 'LIDER' || perfil === 'ADMIN';

  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Contagem
  const [itensEnxoval, setItensEnxoval] = useState<InventoryItemRow[]>([]);
  const [contagens, setContagens] = useState<Record<string, string>>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'divergentes' | 'conferidos'>('todos');
  const [obsContagem, setObsContagem] = useState('');

  // Histórico
  const [conferencias, setConferencias] = useState<InspecaoLista[]>([]);
  const [detalhe, setDetalhe] = useState<ConferenciaDetalhe | null>(null);
  const [fBusca, setFBusca] = useState('');
  const [fFiltro, setFFiltro] = useState<'todos' | 'divergentes' | 'corrigidos'>('todos');

  // Modal correção
  const [corrigirAlvo, setCorrigirAlvo] = useState<InspectionItemRow | null>(null);
  const [tiposUtilizados, setTiposUtilizados] = useState<Record<string, TipoCorrecao>>({});
  const [corrTipo, setCorrTipo] = useState<TipoCorrecao>('APENAS_REGISTRAR_DIVERGENCIA');
  const [corrSpareId, setCorrSpareId] = useState('');
  const [corrQtd, setCorrQtd] = useState('');
  const [corrObs, setCorrObs] = useState('');
  const [corrMatricula, setCorrMatricula] = useState('');
  const [pecas, setPecas] = useState<SparePartRow[]>([]);

  // Modal estorno / finalizar / revisar
  const [estornarAlvo, setEstornarAlvo] = useState<InspectionItemRow | null>(null);
  const [estornarMotivo, setEstornarMotivo] = useState('');
  const [estornarMatricula, setEstornarMatricula] = useState('');
  const [finalizarOpen, setFinalizarOpen] = useState(false);
  const [finalizarObs, setFinalizarObs] = useState('');
  const [finalizarMatricula, setFinalizarMatricula] = useState('');
  const [revisaoOpen, setRevisaoOpen] = useState(false);
  const [revisaoItens, setRevisaoItens] = useState<Record<string, string>>({});
  const [revisaoMatricula, setRevisaoMatricula] = useState('');

  const carregarEnxoval = useCallback(async () => {
    if (!depositoId) return;
    if (navigator.onLine) {
      try {
        await espelharEnxoval(api, depositoId);
      } catch {
        // segue com espelho local
      }
    }
    setItensEnxoval(await listInventoryItemsLocal(depositoId));
  }, [api, depositoId]);

  useEffect(() => {
    void carregarEnxoval();
  }, [carregarEnxoval]);

  useEffect(() => {
    if (!itensEnxoval.length || Object.keys(contagens).length) return;
    const init: Record<string, string> = {};
    for (const i of itensEnxoval) init[i.codigoSap] = String(i.qtdAtual);
    setContagens(init);
  }, [itensEnxoval, contagens]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para conferir.</Alert>;
  }

  const itensContagem = useMemo(() => {
    const base = itensEnxoval.map((i) => {
      const fisica = Number(contagens[i.codigoSap]);
      const finita = Number.isFinite(fisica) ? fisica : 0;
      return {
        item: i,
        qtdFisica: finita,
        status: statusDeItem(i.qtdAtual, finita),
      };
    });
    const q = busca.trim().toLowerCase();
    const comFiltro = filtro === 'todos' ? base : base.filter((b) => b.status === (filtro === 'divergentes' ? 'DIVERGENTE' : 'OK'));
    return q
      ? comFiltro.filter((b) => b.item.codigoSap.toLowerCase().includes(q) || b.item.textoBreve.toLowerCase().includes(q))
      : comFiltro;
  }, [itensEnxoval, contagens, busca, filtro]);

  const resumoContagem = useMemo(
    () => ({
      total: itensEnxoval.length,
      divergentes: itensContagemOriginal(itensEnxoval, contagens),
    }),
    [itensEnxoval, contagens],
  );

  const registrarContagem = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const itens = itensEnxoval
      .map((i) => ({ codigoSap: i.codigoSap, qtdFisica: Number(contagens[i.codigoSap]) }))
      .filter((i) => Number.isFinite(i.qtdFisica));
    if (!itens.length) {
      setMsg({ kind: 'error', text: 'Nenhum item para registrar.' });
      setBusy(false);
      return;
    }
    if (!navigator.onLine) {
      setMsg({ kind: 'error', text: 'Conferência requer conexão (a fila offline cobre goldbox).' });
      setBusy(false);
      return;
    }
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request('POST', `/deposits/${depositoId}/inspections`, {
        hora: agora(),
        observacao: obsContagem.trim() || undefined,
        itens,
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: session.matricula,
      });
      setMsg({ kind: 'info', text: 'Conferência registrada em andamento. Finalize pelo histórico.' });
      setTab('historico');
      await carregarHistorico();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao registrar conferência.' });
    }
    setBusy(false);
  };

  const carregarHistorico = async () => {
    setMsg(null);
    if (!navigator.onLine) {
      setMsg({ kind: 'error', text: 'Histórico de conferências requer conexão.' });
      setConferencias([]);
      return;
    }
    try {
      const res = await api.request<{ conferencias: InspecaoLista[] }>('GET', `/deposits/${depositoId}/inspections`);
      setConferencias(res.conferencias);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao carregar histórico.' });
    }
  };

  const abrirDetalhe = async (inspecaoId: string) => {
    setMsg(null);
    setDetalhe(null);
    try {
      const res = await api.request<ConferenciaDetalhe>('GET', `/deposits/${depositoId}/inspections/${inspecaoId}`);
      setDetalhe(res);
      if (navigator.onLine) {
        const sp = await api.request<{ pecas: SparePartRow[] }>('GET', `/deposits/${depositoId}/spare-parts`);
        setPecas(sp.pecas);
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao abrir conferência.' });
    }
  };

  const fecharDetalhe = () => {
    setDetalhe(null);
    setCorrigirAlvo(null);
    setEstornarAlvo(null);
    setFinalizarOpen(false);
    setRevisaoOpen(false);
  };

const abrirCorrecao = (item: InspectionItemRow) => {
    const usado = tiposUtilizados[item.id] ?? (item.corregido ? 'APENAS_REGISTRAR_DIVERGENCIA' : undefined);
    setCorrigirAlvo(item);
    setCorrTipo((item.corregido ? 'OUTRA' : usado) ?? 'APENAS_REGISTRAR_DIVERGENCIA');
    setCorrSpareId('');
    setCorrQtd(String(Math.abs(item.diferenca) || 1));
    setCorrObs(item.corregido ? 'Nova correção após estorno/ajuste.' : '');
    setCorrMatricula(session.matricula);
  };

  const confirmarCorrecao = async (e: FormEvent) => {
    e.preventDefault();
    if (!corrigirAlvo) return;
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request('POST', `/deposits/${depositoId}/inspections/${corrigirAlvo.inspectionId}/items/${corrigirAlvo.id}/correction`, {
        operationId: crypto.randomUUID(),
        tipo: corrTipo,
        sparePartId: corrTipo === 'CORRIGIR_COM_PECA_AVULSA' ? corrSpareId || undefined : undefined,
        quantidade: corrTipo === 'CORRIGIR_COM_PECA_AVULSA' ? Number(corrQtd) : undefined,
        observacao: corrObs.trim() || undefined,
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: corrMatricula.trim() || session.matricula,
      });
      setMsg({ kind: 'info', text: 'Correção registrada.' });
      setCorrigirAlvo(null);
      setTiposUtilizados((p) => ({ ...p, [corrigirAlvo.id]: corrTipo }));
      if (detalhe) await abrirDetalhe(detalhe.inspecao.id);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao corrigir item.' });
    }
    setBusy(false);
  };

  const confirmarEstorno = async (e: FormEvent) => {
    e.preventDefault();
    if (!estornarAlvo) return;
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request('POST', `/deposits/${depositoId}/inspections/${estornarAlvo.inspectionId}/items/${estornarAlvo.id}/revert-correction`, {
        operationId: crypto.randomUUID(),
        motivo: estornarMotivo.trim(),
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: estornarMatricula.trim() || session.matricula,
      });
      setMsg({ kind: 'info', text: 'Estorno da correção registrado — peça avulsa devolvida e saldo do enxoval debitado.' });
      setEstornarAlvo(null);
      if (detalhe) await abrirDetalhe(detalhe.inspecao.id);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao estornar correção.' });
    }
    setBusy(false);
  };

  const confirmarFinalizar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request('POST', `/deposits/${depositoId}/inspections/${detalhe!.inspecao.id}/finalize`, {
        observacao: finalizarObs.trim() || undefined,
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: finalizarMatricula.trim() || session.matricula,
      });
      setMsg({ kind: 'info', text: 'Conferência concluída — divergências abertas no dashboard.' });
      setFinalizarOpen(false);
      await abrirDetalhe(detalhe!.inspecao.id);
      await carregarHistorico();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao finalizar conferência.' });
    }
    setBusy(false);
  };

  const iniciarRevisao = () => {
    if (!detalhe) return;
    const rev: Record<string, string> = {};
    for (const i of detalhe.itens) rev[i.codigoSap] = String(i.qtdFisica);
    setRevisaoItens(rev);
    setRevisaoMatricula(session.matricula);
    setRevisaoOpen(true);
  };

  const confirmarRevisao = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const itens = detalhe!.itens
        .map((i) => ({ codigoSap: i.codigoSap, qtdFisica: Number(revisaoItens[i.codigoSap]) }))
        .filter((i) => Number.isFinite(i.qtdFisica));
      await api.request('POST', `/deposits/${depositoId}/inspections/${detalhe!.inspecao.id}/revision`, {
        hora: agora(),
        itens,
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: revisaoMatricula.trim() || session.matricula,
      });
      setMsg({ kind: 'info', text: 'Revisão criada — nova conferência REVISADA referenciando a original.' });
      setRevisaoOpen(false);
      await carregarHistorico();
      setDetalhe(null);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao revisar conferência.' });
    }
    setBusy(false);
  };

  const pecasDoItem = corrigirAlvo
    ? pecas.filter((p) => p.codigoSap === corrigirAlvo.codigoSap && p.quantidadeAtual > 0)
    : [];

  return (
    <div>
      <h2 className="screen-title">Conferências</h2>
      <div className="list-sub" style={{ marginBottom: '0.5rem' }}>
        {session.depositoAtivo.nome} · conferência física do enxoval
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <Btn variant={tab === 'contar' ? 'primary' : 'ghost'} className="small" onClick={() => setTab('contar')}>
          Nova contagem
        </Btn>
        <Btn variant={tab === 'historico' ? 'primary' : 'ghost'} className="small" onClick={() => { setTab('historico'); void carregarHistorico(); }}>
          Histórico
        </Btn>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {tab === 'contar' && (
        <form onSubmit={registrarContagem} className="card">
          <h3>Contagem do enxoval</h3>
          <div className="list-sub">Saldo do sistema como padrão — ajuste o que divergir fisicamente.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem' }}>
            <Field id="ct-busca" placeholder="Código SAP ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtro de itens">
              <option value="todos">Todos</option>
              <option value="divergentes">Divergentes</option>
              <option value="conferidos">Conferidos</option>
            </select>
          </div>
          <div className="list-sub" style={{ margin: '0.4rem 0' }}>
            {itensEnxoval.length} itens · {resumoContagem.divergentes} divergentes
          </div>

          <div style={{ maxHeight: '46vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '0.8rem' }}>
            {itensContagem.length === 0 && <div className="list-sub" style={{ padding: '0.5rem' }}>Nada encontrado.</div>}
            {itensContagem.map(({ item, qtdFisica, status }) => (
              <div
                key={item.id}
                className="list-item"
                style={{
                  borderLeft: selecionado === item.codigoSap ? '3px solid var(--primary)' : '3px solid transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setSelecionado(item.codigoSap)}
                onContextMenu={(e) => { e.preventDefault(); setSelecionado(item.codigoSap); }}
              >
                <div style={{ flex: 1 }}>
                  <div className="list-title">{item.codigoSap}</div>
                  <div className="list-sub">{item.textoBreve}</div>
                  <div className="list-sub">
                    sistema {item.qtdAtual} {item.unidadeMedida ?? ''} · física {qtdFisica} {item.unidadeMedida ?? ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                  <span className={`chip ${status === 'DIVERGENTE' ? 'warn' : 'ok'}`}>{status}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Btn variant="ghost" className="small" type="button"
                      onClick={(e) => { e.stopPropagation(); setContagens((p) => ({ ...p, [item.codigoSap]: String(Math.max(0, qtdFisica - 1)) })); }}>
                      −
                    </Btn>
                    <input
                      type="number"
                      value={contagens[item.codigoSap]}
                      onChange={(e) => setContagens((p) => ({ ...p, [item.codigoSap]: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '4.5rem', textAlign: 'center' }}
                      aria-label={`Quantidade física de ${item.codigoSap}`}
                    />
                    <Btn variant="ghost" className="small" type="button"
                      onClick={(e) => { e.stopPropagation(); setContagens((p) => ({ ...p, [item.codigoSap]: String(qtdFisica + 1) })); }}>
                      +
                    </Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Field id="ct-obs" label="Observação geral" value={obsContagem} onChange={(e) => setObsContagem(e.target.value)} placeholder="Opcional" />
          <Btn type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar conferência (em andamento)'}</Btn>
        </form>
      )}

      {tab === 'historico' && !detalhe && (
        <div className="card">
          <h3>Histórico de conferências</h3>
          <Field id="ht-busca" placeholder="Buscar por código" value={fBusca} onChange={(e) => setFBusca(e.target.value)} />
          <select value={fFiltro} onChange={(e) => setFFiltro(e.target.value as typeof fFiltro)} style={{ marginTop: '0.4rem' }} aria-label="Filtro do histórico">
            <option value="todos">Todas</option>
            <option value="divergentes">Com divergências</option>
            <option value="corrigidos">Com correções</option>
          </select>
          <div style={{ marginTop: '0.6rem' }}>
            {conferencias.length === 0 && <div className="list-sub">Nenhuma conferência encontrada.</div>}
            {conferencias
              .filter((c) => {
                if (fFiltro === 'divergentes') return c.divergentes > 0;
                if (fFiltro === 'corrigidos') return c.tipoCorrecao !== undefined && c.tipoCorrecao !== null;
                return true;
              })
              .filter((c) => !fBusca.trim() || c.id.toLowerCase().includes(fBusca.trim().toLowerCase()))
              .map((c) => (
                <button key={c.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => void abrirDetalhe(c.id)}>
                  <div>
                    <div className="list-title">
                      {INSPECAO_STATUS_LABEL[c.status] ?? c.status} · {new Date(c.dataEm).toLocaleDateString('pt-BR')} {c.hora}
                      {c.revisaoDe ? ` · revisão de ${c.revisaoDe.slice(0, 8)}` : ''}
                    </div>
                    <div className="list-sub">
                      {c.matricula} · {c.totalItens} itens · {c.divergentes} divergentes
                      {c.tipoCorrecao ? ` · ${TIPO_CORRECAO_LABEL[c.tipoCorrecao]}` : ''}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {tab === 'historico' && detalhe && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>{INSPECAO_STATUS_LABEL[detalhe.inspecao.status] ?? detalhe.inspecao.status}</h3>
            <Btn variant="ghost" className="small" onClick={fecharDetalhe}>Voltar</Btn>
          </div>
          <div className="list-sub">
            {new Date(detalhe.inspecao.dataEm).toLocaleDateString('pt-BR')} {detalhe.inspecao.hora} · autor {detalhe.inspecao.matricula} · versão {detalhe.inspecao.versaoEnxoval}
            {detalhe.inspecao.revisaoDe ? ` · revisão de ${detalhe.inspecao.revisaoDe.slice(0, 8)}` : ''}
            {detalhe.inspecao.observacao ? ` · ${detalhe.inspecao.observacao}` : ''}
          </div>
          {(() => {
            const r = resumoDeItens(detalhe.itens);
            return (
              <div className="list-sub" style={{ margin: '0.4rem 0' }}>
                {r.total} itens · {r.ok} OK · {r.divergentes} divergentes · {r.pendentes} pendentes · {r.corrigidos} corrigidos
              </div>
            );
          })()}

          <div style={{ maxHeight: '42vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '0.8rem' }}>
            {detalhe.itens
              .filter((i) => (fFiltro === 'corrigidos' ? i.corregido : true))
              .map((i) => (
              <div key={i.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="list-title">{i.codigoSap} {i.corregido ? '· corrigido ✓' : ''}</div>
                  <div className="list-sub">
                    sistema {i.qtdSistema} · física {i.qtdFisica} · diferença {i.diferenca > 0 ? '+' : ''}{i.diferenca}
                  </div>
                  {i.ultimaBaixaGoldbox && (
                    <div className="list-sub">última baixa goldbox: {new Date(i.ultimaBaixaGoldbox.dataHora).toLocaleDateString('pt-BR')} ({i.ultimaBaixaGoldbox.quantidade})</div>
                  )}
                  {i.reposicaoPosterior && <div className="list-sub">reposição posterior à conferência</div>}
                  {i.reposicaoPendente && <div className="list-sub warn">reposição pendente (almoxarifado)</div>}
                  {typeof i.sparePartDisponivel === 'number' && i.sparePartDisponivel > 0 && (
                    <div className="list-sub">peça avulsa disponível: {i.sparePartDisponivel}</div>
                  )}
                  {i.corregido && i.correcaoRef && <div className="list-sub">correção ref {i.correcaoRef.slice(0, 8)}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                  <span className={`chip ${i.status === 'DIVERGENTE' ? 'warn' : i.status === 'PENDENTE' ? 'warn' : 'ok'}`}>{i.status}</span>
                  {!i.corregido && (
                    <Btn variant="secondary" className="small" onClick={() => abrirCorrecao(i)}>Corrigir</Btn>
                  )}
                  {i.corregido && podeEstornar && (
                    <Btn variant="ghost" className="small" onClick={() => { setEstornarAlvo(i); setEstornarMotivo(''); setEstornarMatricula(session.matricula); }}>Estornar</Btn>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {detalhe.inspecao.status === 'EM_ANDAMENTO' && (
              <Btn onClick={() => setFinalizarOpen(true)}>Finalizar conferência</Btn>
            )}
            <Btn variant={detalhe.inspecao.status === 'CONCLUIDA' ? 'primary' : 'secondary'} onClick={iniciarRevisao}>
              Revisar contagem
            </Btn>
          </div>
        </div>
      )}

      {corrigirAlvo && (
        <form onSubmit={confirmarCorrecao} className="card" style={{ marginTop: '0.8rem' }}>
          <h3>Correção de {corrigirAlvo.codigoSap}</h3>
          <div className="list-sub">
            sistema {corrigirAlvo.qtdSistema} · física {corrigirAlvo.qtdFisica} · diferença {corrigirAlvo.diferenca}
          </div>
          <SelectField id="co-tipo" label="Tratamento da divergência" value={corrTipo} onChange={(e) => setCorrTipo(e.target.value as TipoCorrecao)}>
            {TIPOS.map((t) => <option key={t} value={t}>{TIPO_CORRECAO_LABEL[t]}</option>)}
          </SelectField>
          {corrTipo === 'CORRIGIR_COM_PECA_AVULSA' && (
            <>
              <SelectField id="co-peca" label="Peça avulsa (mesmo depósito)" value={corrSpareId}
                onChange={(e) => setCorrSpareId(e.target.value)} required={pecasDoItem.length > 0}>
                {pecasDoItem.length === 0 && <option value="">Sem peça avulsa disponível para este SAP</option>}
                {pecasDoItem.map((p) => (
                  <option key={p.id} value={p.id}>{p.codigoSap} · {p.descricao.slice(0, 40)} (saldo {p.quantidadeAtual})</option>
                ))}
              </SelectField>
              <Field id="co-qtd" label="Quantidade aplicada" type="number" min="1" value={corrQtd} onChange={(e) => setCorrQtd(e.target.value)} required />
            </>
          )}
          <Field id="co-obs" label="Observação" value={corrObs} onChange={(e) => setCorrObs(e.target.value)} placeholder="Opcional" />
          <Field id="co-mat" label="Matrícula de confirmação" value={corrMatricula} onChange={(e) => setCorrMatricula(e.target.value)} required />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn type="submit" disabled={busy}>{busy ? 'Corrigindo…' : 'Confirmar correção'}</Btn>
            <Btn type="button" variant="ghost" onClick={() => setCorrigirAlvo(null)}>Cancelar</Btn>
          </div>
        </form>
      )}

      {estornarAlvo && (
        <form onSubmit={confirmarEstorno} className="card" style={{ marginTop: '0.8rem' }}>
          <div className="list-title">Estornar correção de {estornarAlvo.codigoSap}</div>
          <div className="list-sub">Devolve a peça avulsa usada e debita o saldo do enxoval.</div>
          <Field id="et-motivo" label="Motivo" value={estornarMotivo} onChange={(e) => setEstornarMotivo(e.target.value)} required placeholder="Ex.: quantidade errada" />
          <Field id="et-mat" label="Matrícula de confirmação" value={estornarMatricula} onChange={(e) => setEstornarMatricula(e.target.value)} required />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn type="submit" variant="danger" disabled={busy}>{busy ? 'Estornando…' : 'Confirmar estorno'}</Btn>
            <Btn type="button" variant="ghost" onClick={() => setEstornarAlvo(null)}>Cancelar</Btn>
          </div>
        </form>
      )}

      {finalizarOpen && detalhe && (
        <form onSubmit={confirmarFinalizar} className="card" style={{ marginTop: '0.8rem' }}>
          <div className="list-title">Finalizar conferência</div>
          <div className="list-sub">Serão abertas divergências CONFERENCIA para {detalhe.itens.filter((i) => i.status === 'DIVERGENTE').length} item(ns).</div>
          <Field id="fn-obs" label="Observação" value={finalizarObs} onChange={(e) => setFinalizarObs(e.target.value)} placeholder="Opcional" />
          <Field id="fn-mat" label="Matrícula de confirmação" value={finalizarMatricula} onChange={(e) => setFinalizarMatricula(e.target.value)} required />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn type="submit" disabled={busy}>{busy ? 'Finalizando…' : 'Confirmar finalização'}</Btn>
            <Btn type="button" variant="ghost" onClick={() => setFinalizarOpen(false)}>Cancelar</Btn>
          </div>
        </form>
      )}

      {revisaoOpen && detalhe && (
        <form onSubmit={confirmarRevisao} className="card" style={{ marginTop: '0.8rem' }}>
          <div className="list-title">Revisar contagem</div>
          <div className="list-sub">Cria uma nova inspeção REVISADA; a original é preservada.</div>
          <div style={{ maxHeight: '30vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '0.6rem' }}>
            {detalhe.itens.map((i) => (
              <div key={i.id} className="list-item">
                <div className="list-title" style={{ flex: 1 }}>{i.codigoSap}</div>
                <input
                  type="number"
                  value={revisaoItens[i.codigoSap] ?? ''}
                  onChange={(e) => setRevisaoItens((p) => ({ ...p, [i.codigoSap]: e.target.value }))}
                  style={{ width: '5rem' }}
                  aria-label={`Quantidade revisada de ${i.codigoSap}`}
                />
              </div>
            ))}
          </div>
          <Field id="rv-mat" label="Matrícula de confirmação" value={revisaoMatricula} onChange={(e) => setRevisaoMatricula(e.target.value)} required />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar revisão'}</Btn>
            <Btn type="button" variant="ghost" onClick={() => setRevisaoOpen(false)}>Cancelar</Btn>
          </div>
        </form>
      )}
    </div>
  );
}

function itensContagemOriginal(itens: InventoryItemRow[], contagens: Record<string, string>): number {
  let div = 0;
  for (const i of itens) {
    const fisica = Number(contagens[i.codigoSap]);
    if (Number.isFinite(fisica) && fisica !== i.qtdAtual) div += 1;
  }
  return div;
}