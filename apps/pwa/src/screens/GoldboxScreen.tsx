import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { GoldboxMovementRow, InventoryItemRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { assinarMatricula } from '../lib/assinatura';
import { analisarBaixa } from '../lib/goldbox';
import { listInventoryItemsLocal, listMovimentosLocais, registrarBaixaOffline } from '../repos/local';
import { espelharEnxoval } from '../services/sync';

type Tab = 'baixa' | 'historico';

interface BaixaResult {
  jaProcessada: boolean;
  saldo: number;
  divergenciaCriada: boolean;
}

export function GoldboxScreen() {
  const { api, session, deviceId } = useAuth();
  const [tab, setTab] = useState<Tab>('baixa');

  const [itens, setItens] = useState<InventoryItemRow[]>([]);
  const [busca, setBusca] = useState('');
  const [codigoSap, setCodigoSap] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [reposicao, setReposicao] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [movs, setMovs] = useState<GoldboxMovementRow[]>([]);
  const [fDataIni, setFDataIni] = useState('');
  const [fDataFim, setFDataFim] = useState('');
  const [fCodigoSap, setFCodigoSap] = useState('');
  const [fUsuario, setFUsuario] = useState('');
  const [fReposicao, setFReposicao] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [histMsg, setHistMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const [estornoAlvo, setEstornoAlvo] = useState<GoldboxMovementRow | null>(null);
  const [estornoMotivo, setEstornoMotivo] = useState('');
  const [estornoPin, setEstornoPin] = useState('');
  const [estornoBusy, setEstornoBusy] = useState(false);

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const podeEstornar = perfil === 'LIDER' || perfil === 'ADMIN';

  const carregar = useCallback(async () => {
    if (!depositoId) return;
    if (navigator.onLine) {
      try {
        await espelharEnxoval(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    setItens(await listInventoryItemsLocal(depositoId));
  }, [api, depositoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para registrar baixas.</Alert>;
  }

  const abertos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q
      ? itens.filter(
          (i) =>
            i.codigoSap.toLowerCase().includes(q) ||
            i.textoBreve.toLowerCase().includes(q) ||
            (i.materialId ?? '').toLowerCase().includes(q),
        )
      : itens;
  }, [itens, busca]);

  const selecionarItem = (i: InventoryItemRow) => {
    setCodigoSap(i.codigoSap);
    setDescricao(i.textoBreve);
    setBusca('');
    setMsg(null);
  };

  const itemAtivo = useMemo(() => {
    const sap = codigoSap.trim().toLowerCase();
    if (!sap) return null;
    return itens.find((i) => i.codigoSap.trim().toLowerCase() === sap) ?? null;
  }, [itens, codigoSap]);

  const analise = analisarBaixa(itemAtivo, quantidade);

  const registrarBaixa = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (!codigoSap.trim()) {
      setMsg({ kind: 'error', text: 'Selecione um item do enxoval.' });
      setBusy(false);
      return;
    }
    const qty = Number(quantidade);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMsg({ kind: 'error', text: 'Quantidade precisa ser maior que zero.' });
      setBusy(false);
      return;
    }
    if (!navigator.onLine) {
      const assinatura = await assinarMatricula(session.matricula);
      await registrarBaixaOffline({
        operationId: crypto.randomUUID(),
        depositoId,
        codigoSap: codigoSap.trim(),
        descricao: descricao.trim() || undefined,
        quantidade: qty,
        reposicao,
        dataHora: new Date().toISOString(),
        usuarioId: session.userId,
        nomeCompleto: session.nomeCompleto,
        matricula: session.matricula,
        dispositivo: deviceId,
        assinaturaMatricula: assinatura,
      });
      setQuantidade('1');
      setMsg({ kind: 'info', text: 'Baixa registrada no dispositivo (offline). Será enviada quando houver conexão.' });
      await carregar();
      setBusy(false);
      return;
    }
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const res = await api.request<{ baixa: GoldboxMovementRow } & BaixaResult>('POST', `/deposits/${depositoId}/goldbox/baixa`, {
        operationId: crypto.randomUUID(),
        codigoSap: codigoSap.trim(),
        descricao: descricao.trim() || undefined,
        quantidade: qty,
        reposicao,
        origem: 'ONLINE',
        dispositivo: deviceId,
        dataHora: new Date().toISOString(),
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: session.matricula,
      });
      setQuantidade('1');
      setMsg({
        kind: 'info',
        text:
          res.jaProcessada
            ? 'Operação já processada anteriormente (idempotente).'
            : `Baixa registrada. Novo saldo: ${res.saldo} ${res.divergenciaCriada ? '· criada divergência de saldo negativo!' : ''}`,
      });
      await carregar();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao registrar baixa.' });
    }
    setBusy(false);
  };

  const carregarHistorico = async () => {
    setHistMsg(null);
    if (!navigator.onLine) {
      const locais = await listMovimentosLocais(depositoId);
      const tipos = fTipo ? (fTipo === 'ESTORNO' ? (m: GoldboxMovementRow) => !!m.estornoDe : (m: GoldboxMovementRow) => !m.estornoDe) : () => true;
      setMovs(
        locais.filter(
          (m) =>
            tipos(m) &&
            (!fCodigoSap.trim() || m.codigoSap === fCodigoSap.trim()) &&
            (!fUsuario.trim() || m.matricula === fUsuario.trim()) &&
            (!fReposicao || (m.reposicao === (fReposicao === 'true'))),
        ),
      );
      setHistMsg({ kind: 'info', text: 'Modo offline — exibindo movimentações locais (incl. pendentes).' });
      return;
    }
    try {
      const q = new URLSearchParams();
      if (fDataIni) q.set('dataIni', new Date(`${fDataIni}T00:00:00`).toISOString());
      if (fDataFim) q.set('dataFim', new Date(`${fDataFim}T23:59:59.999`).toISOString());
      if (fCodigoSap.trim()) q.set('codigoSap', fCodigoSap.trim());
      if (fUsuario.trim()) q.set('usuario', fUsuario.trim());
      if (fReposicao) q.set('reposicao', fReposicao);
      if (fTipo) q.set('tipo', fTipo);
      const res = await api.request<{ movimentos: GoldboxMovementRow[] }>(
        'GET',
        `/deposits/${depositoId}/goldbox${q.toString() ? `?${q.toString()}` : ''}`,
      );
      setMovs(res.movimentos);
      setHistMsg({ kind: 'info', text: `${res.movimentos.length} movimento(s) encontrados.` });
    } catch (err) {
      setHistMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao carregar histórico.' });
    }
  };

  const abortarEstorno = () => {
    setEstornoAlvo(null);
    setEstornoMotivo('');
    setEstornoPin('');
  };

  const confirmarEstorno = async (e: FormEvent) => {
    e.preventDefault();
    if (!estornoAlvo) return;
    if (!navigator.onLine) {
      setHistMsg({ kind: 'error', text: 'Estorno requer conexão — baixe os estornos na fase 05 ficam online.' });
      return;
    }
    setEstornoBusy(true);
    setHistMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request('POST', `/deposits/${depositoId}/goldbox/estorno`, {
        operationId: crypto.randomUUID(),
        operationIdOriginal: estornoAlvo.operationId,
        motivo: estornoMotivo.trim(),
        assinaturaMatricula: assinatura,
        pin: estornoPin.trim() || undefined,
        matriculaConfirmacao: session.matricula,
      });
      abortarEstorno();
      setHistMsg({ kind: 'info', text: 'Estorno registrado e saldo ajustado.' });
      await carregar();
      await carregarHistorico();
    } catch (err) {
      setHistMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao estornar.' });
    }
    setEstornoBusy(false);
  };

  const inicioDoDia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

  return (
    <div>
      <h2 className="screen-title">Goldbox</h2>
      <div className="list-sub" style={{ marginBottom: '0.5rem' }}>
        {session.depositoAtivo.nome} · baixas de reposição de materiais
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <Btn variant={tab === 'baixa' ? 'primary' : 'ghost'} className="small" onClick={() => setTab('baixa')}>
          Registrar baixa
        </Btn>
        <Btn variant={tab === 'historico' ? 'primary' : 'ghost'} className="small" onClick={() => setTab('historico')}>
          Histórico
        </Btn>
      </div>

      {tab === 'baixa' && (
        <div className="card">
          <h3>Nova baixa</h3>
          <Field
            id="gold-busca"
            label="Buscar item do enxoval"
            placeholder="Código SAP, descrição ou material"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px' }}>
              {abertos.length === 0 && <div className="list-sub" style={{ padding: '0.5rem' }}>Nada encontrado.</div>}
              {abertos.slice(0, 12).map((i) => (
                <button key={i.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => selecionarItem(i)}>
                  <div>
                    <div className="list-title">{i.codigoSap} · {i.textoBreve}</div>
                    <div className="list-sub">saldo {i.qtdAtual} / oficial {i.qtdOficial} {i.unidadeMedida ?? ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={registrarBaixa}>
            <Field id="gold-sap" label="Código SAP" value={codigoSap} onChange={(e) => setCodigoSap(e.target.value)} required placeholder="1002341" />
            <Field id="gold-desc" label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" />
            <Field id="gold-qtd" label="Quantidade" type="number" min="0" step="any" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} required />

            {analise.status === 'item' && (
              <div
                style={{
                  display: 'flex',
                  gap: '0.4rem',
                  flexWrap: 'wrap',
                  marginTop: '0.4rem',
                  padding: '0.4rem 0.6rem',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                }}
              >
                <span className="list-sub">
                  Disponível: <b>{analise.disponivel}</b> {itemAtivo?.unidadeMedida ?? ''} · oficial:{' '}
                  {itemAtivo?.qtdOficial} {itemAtivo?.unidadeMedida ?? ''}
                </span>
                {analise.validada && (
                  <span className="list-sub">
                    Após a baixa: <b>{analise.aposBaixa}</b>
                  </span>
                )}
                {analise.vaiNegativar && (
                  <span className="list-title warn" role="alert">
                    ⚠ A baixa de {quantidade} deixa o saldo negativo ({analise.aposBaixa}). Confira se é intencional —
                    divergência será sinalizada na sincronização.
                  </span>
                )}
              </div>
            )}

            <label className="list-sub" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={reposicao} onChange={(e) => setReposicao(e.target.checked)} />
              É reposição
            </label>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            <div style={{ marginTop: '0.6rem' }}>
              <Btn type="submit" disabled={busy}>
                {busy ? 'Registrando…' : 'Registrar baixa'}
              </Btn>
            </div>
          </form>
        </div>
      )}

      {tab === 'historico' && (
        <div className="card">
          <h3>Histórico de movimentações</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.4rem' }}>
            <Field id="f-ini" label="De" type="date" value={fDataIni} onChange={(e) => setFDataIni(e.target.value)} />
            <Field id="f-fim" label="Até" type="date" value={fDataFim} onChange={(e) => setFDataFim(e.target.value)} />
            <Field id="f-sap" label="Código SAP" value={fCodigoSap} onChange={(e) => setFCodigoSap(e.target.value)} />
            <Field id="f-usu" label="Matrícula usuário" value={fUsuario} onChange={(e) => setFUsuario(e.target.value)} />
            <label className="list-sub">Reposição<select id="f-rep" value={fReposicao} onChange={(e) => setFReposicao(e.target.value)} style={{ display: 'block', marginTop: '0.2rem' }}>
              <option value="">Todas</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select></label>
            <label className="list-sub">Tipo<select id="f-tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ display: 'block', marginTop: '0.2rem' }}>
              <option value="">Todos</option>
              <option value="BAIXA">Baixa</option>
              <option value="ESTORNO">Estorno</option>
            </select></label>
          </div>
          <Btn className="small" style={{ marginTop: '0.6rem' }} onClick={() => void carregarHistorico()} disabled={busy}>
            Buscar
          </Btn>
          {histMsg && <Alert kind={histMsg.kind}><span role="alert">{histMsg.text}</span></Alert>}

          {estornoAlvo && (
            <form onSubmit={confirmarEstorno} className="card" style={{ marginTop: '0.8rem', background: 'transparent' }}>
              <div className="list-title">Estornar baixa de {estornoAlvo.codigoSap} (qtd {estornoAlvo.quantidade})</div>
              <Field id="es-motivo" label="Motivo do estorno" value={estornoMotivo} onChange={(e) => setEstornoMotivo(e.target.value)} required placeholder="Ex.: conferência física divergiu" />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field id="es-pin" label="PIN (se exigido em Configurações)" type="password" value={estornoPin} onChange={(e) => setEstornoPin(e.target.value)} />
                <Btn type="submit" variant="danger" disabled={estornoBusy}>{estornoBusy ? 'Estornando…' : 'Confirmar estorno'}</Btn>
                <Btn type="button" variant="ghost" className="small" onClick={abortarEstorno}>Cancelar</Btn>
              </div>
            </form>
          )}

          <div style={{ marginTop: '0.8rem' }}>
            {movs.length === 0 && <div className="list-sub">Nenhum movimento para os filtros informados.</div>}
            {movs.map((m) => (
              <div key={m.id} className="list-item">
                <div>
                  <div className="list-title">
                    {m.estornoDe ? 'Estorno' : 'Baixa'} · {m.codigoSap} {m.descricao ? `· ${m.descricao}` : ''}
                  </div>
                  <div className="list-sub">
                    {inicioDoDia(m.dataHora)} · {m.nomeCompleto} ({m.matricula}) · {m.reposicao ? 'reposição' : 'uso'} · {m.origem}
                    {m.estornoDe && ` · estorno de ${m.estornoDe}`}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                  <div className={m.estornoDe ? 'list-title ok' : 'list-title warn'} style={{ fontWeight: 600 }}>{m.quantidade}</div>
                  {podeEstornar && !m.estornoDe && (
                    <Btn variant="ghost" className="small" onClick={() => { setEstornoAlvo(m); setEstornoMotivo(''); }}>
                      Estornar
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}