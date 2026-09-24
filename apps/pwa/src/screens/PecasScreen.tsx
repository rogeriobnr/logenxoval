import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  ConversionSuggestionRow,
  OrigemSparePart,
  SparePartMovementRow,
  SparePartRow,
  SugestaoStatus,
} from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field, SelectField } from '../components/ui';
import { assinarMatricula } from '../lib/assinatura';
import {
  filtrarPecas,
  ORIGEM_SPARE_PART_LABEL,
  resumoDePecas,
  SUGESTAO_STATUS_LABEL,
  TIPO_MOVIMENTO_PECA_LABEL,
} from '../lib/pecas';
import {
  listSparePartsLocal,
  listSuggestionsLocal,
  registrarEntradaPecaOffline,
  registrarMovimentoPecaOffline,
  registrarRespostaSugestaoOffline,
} from '../repos/local';
import { espelharPecas } from '../services/sync';

type Tab = 'pecas' | 'sugestoes';

const ORIGENS: OrigemSparePart[] = ['BACKLOG', 'OUTRA_FRENTE', 'COMPRA_DEBITO_DIRETO', 'LIDERANCA', 'OUTRO'];

/** Tipos de movimento escolhíveis na tela (ajuste tem fluxo próprio e exige conexão). */
type TipoMovimentoForm = 'SAIDA' | 'USO_CORRECAO' | 'TRANSFERENCIA_INFORMATIVA' | 'DESCARTE';

const TIPOS_LIVRES: TipoMovimentoForm[] = [
  'SAIDA',
  'USO_CORRECAO',
  'TRANSFERENCIA_INFORMATIVA',
];

export function PecasScreen() {
  const { api, session, online } = useAuth();
  const [tab, setTab] = useState<Tab>('pecas');
  const [msg, setMsg] = useState<{ kind: 'error' | 'warn' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const podeEntrada = perfil === 'LIDER' || perfil === 'ADMIN';

  // Peças
  const [pecas, setPecas] = useState<SparePartRow[]>([]);
  const [busca, setBusca] = useState('');
  const [soComSaldo, setSoComSaldo] = useState(false);

  // Form de entrada (online)
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [entSap, setEntSap] = useState('');
  const [entDesc, setEntDesc] = useState('');
  const [entOrigem, setEntOrigem] = useState<OrigemSparePart>('BACKLOG');
  const [entQtd, setEntQtd] = useState('1');
  const [entObs, setEntObs] = useState('');

  // Movimentação
  const [movAlvo, setMovAlvo] = useState<SparePartRow | null>(null);
  const [movTipo, setMovTipo] = useState<TipoMovimentoForm>('SAIDA');
  const [movQtd, setMovQtd] = useState('1');
  const [movMotivo, setMovMotivo] = useState('');

  // Ajuste autorizado (online)
  const [ajusteAlvo, setAjusteAlvo] = useState<SparePartRow | null>(null);
  const [ajusteNovoSaldo, setAjusteNovoSaldo] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('');

  // Sugestões
  const [sugestoes, setSugestoes] = useState<ConversionSuggestionRow[]>([]);

  const recarregar = useCallback(async () => {
    if (!depositoId) return;
    if (online) {
      try {
        await espelharPecas(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    setPecas(await listSparePartsLocal(depositoId));
    setSugestoes(await listSuggestionsLocal(depositoId));
  }, [api, depositoId, online]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para gerenciar peças avulsas.</Alert>;
  }

  const resumo = resumoDePecas(pecas);
  const pecasVisiveis = filtrarPecas(pecas, { busca, soComSaldo });

  const registrarEntrada = async (e: FormEvent) => {
    e.preventDefault();
    const quantidade = Number(entQtd);
    if (!entSap.trim() || !entDesc.trim() || !quantidade || quantidade <= 0 || !podeEntrada) return;
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      if (online) {
        await api.request<{ peca: SparePartRow; jaProcessada: boolean }>('POST', `/deposits/${depositoId}/spare-parts`, {
          operationId: crypto.randomUUID(),
          codigoSap: entSap.trim(),
          descricao: entDesc.trim(),
          origem: entOrigem,
          quantidade,
          observacao: entObs.trim() || undefined,
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: session.matricula,
        });
        setMsg({ kind: 'info', text: 'Entrada registrada.' });
      } else {
        await registrarEntradaPecaOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          codigoSap: entSap.trim(),
          descricao: entDesc.trim(),
          origem: entOrigem,
          quantidade,
          observacao: entObs.trim() || undefined,
          usuarioId: session.userId,
          nomeCompleto: session.nomeCompleto,
          matricula: session.matricula,
          dispositivo: session.matricula,
          assinaturaMatricula: assinatura,
        });
        setMsg({ kind: 'info', text: 'Entrada registrada offline — sincroniza quando reconectar.' });
      }
      setEntSap('');
      setEntDesc('');
      setEntQtd('1');
      setEntObs('');
      setEntradaAberta(false);
      await recarregar();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao registrar entrada' });
    } finally {
      setBusy(false);
    }
  }

  const confirmarMovimento = async () => {
    if (!movAlvo) return;
    const quantidade = Number(movQtd);
    const tipo = movTipo;
    if (!quantidade || quantidade <= 0) return;
    if (online) {
      setBusy(true);
      setMsg(null);
      try {
        const assinatura = await assinarMatricula(session.matricula);
        await api.request<{ peca: SparePartRow; movement: SparePartMovementRow }>(
          'POST',
          `/deposits/${depositoId}/spare-parts/${movAlvo.id}/movements`,
          {
            operationId: crypto.randomUUID(),
            tipo,
            quantidade,
            motivo: movMotivo.trim() || undefined,
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        setMsg({ kind: 'info', text: `${TIPO_MOVIMENTO_PECA_LABEL[tipo]} registrada.` });
      } catch (err) {
        setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao movimentar peça' });
        return;
      } finally {
        setBusy(false);
      }
    } else {
      // Offline: saída/uso/transferência informativa vão para a fila.
      if (movAlvo.id.startsWith('local:')) {
        setMsg({ kind: 'warn', text: 'Sincronize primeiro — essa peça ainda não existe no servidor.' });
        return;
      }
      setBusy(true);
      setMsg(null);
      try {
        const assinatura = await assinarMatricula(session.matricula);
        await registrarMovimentoPecaOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          sparePartId: movAlvo.id,
          tipo,
          quantidade,
          motivo: movMotivo.trim() || undefined,
          usuarioId: session.userId,
          matricula: session.matricula,
          dispositivo: session.matricula,
          assinaturaMatricula: assinatura,
        });
        setMsg({ kind: 'info', text: `${TIPO_MOVIMENTO_PECA_LABEL[tipo]} registrada offline — sincroniza quando reconectar.` });
      } catch (err) {
        setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao registrar movimento' });
        return;
      } finally {
        setBusy(false);
      }
    }
    setMovAlvo(null);
    setMovQtd('1');
    setMovMotivo('');
    await recarregar();
  }

  const confirmarAjuste = async () => {
    if (!ajusteAlvo) return;
    const novoSaldo = Number(ajusteNovoSaldo);
    if (!Number.isInteger(novoSaldo) || novoSaldo < 0) {
      setMsg({ kind: 'warn', text: 'Novo saldo deve ser um inteiro maior ou igual a zero.' });
      return;
    }
    if (!online) {
      setMsg({ kind: 'warn', text: 'Ajuste autorizado exige conexão com a rede.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request<{ peca: SparePartRow }>(
        'POST',
        `/deposits/${depositoId}/spare-parts/${ajusteAlvo.id}/movements`,
        {
          operationId: crypto.randomUUID(),
          tipo: 'AJUSTE_AUTORIZADO',
          novoSaldo,
          motivo: ajusteMotivo.trim() || undefined,
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: session.matricula,
        },
      );
      setMsg({ kind: 'info', text: 'Saldo ajustado.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao ajustar saldo' });
      return;
    } finally {
      setBusy(false);
    }
    setAjusteAlvo(null);
    setAjusteNovoSaldo('');
    setAjusteMotivo('');
    await recarregar();
  }

  const confirmarDescarte = async () => {
    if (!movAlvo) return;
    const quantidade = Number(movQtd);
    if (!quantidade || quantidade <= 0) return;
    if (!online) {
      setMsg({ kind: 'warn', text: 'Descarte exige conexão (confirmação de liderança/PIN).' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request<{ peca: SparePartRow }>(
        'POST',
        `/deposits/${depositoId}/spare-parts/${movAlvo.id}/movements`,
        {
          operationId: crypto.randomUUID(),
          tipo: 'DESCARTE',
          quantidade,
          motivo: movMotivo.trim(),
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: session.matricula,
        },
      );
      setMsg({ kind: 'info', text: 'Descarte registrado.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao descartar' });
      return;
    } finally {
      setBusy(false);
    }
    setMovAlvo(null);
    setMovQtd('1');
    setMovMotivo('');
    await recarregar();
  }

  const responderSugestao = async (s: ConversionSuggestionRow, acao: SugestaoStatus) => {
    const motivoBruto = acao === 'RECUSADA' ? window.prompt('Motivo da recusa:') : undefined;
    if (acao === 'RECUSADA' && !motivoBruto) {
      setMsg({ kind: 'warn', text: 'Motivo é obrigatório para recusar.' });
      return;
    }
    const motivo = motivoBruto ?? undefined;
    setBusy(true);
    setMsg(null);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const payload = {
        operationId: crypto.randomUUID(),
        acao,
        ...(motivo ? { motivo } : {}),
        assinaturaMatricula: assinatura,
        matriculaConfirmacao: session.matricula,
      };
      if (online) {
        await api.request<{ sugestao: ConversionSuggestionRow }>(
          'POST',
          `/deposits/${depositoId}/conversion-suggestions/${s.id}/respond`,
          payload,
        );
        setMsg({ kind: 'info', text: `Sugestão ${acao === 'ACEITA' ? 'aceita' : 'recusada'} e peças convertidas.` });
      } else {
        await registrarRespostaSugestaoOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          suggestionId: s.id,
          acao,
          motivo,
          usuarioId: session.userId,
          matricula: session.matricula,
          dispositivo: session.matricula,
          assinaturaMatricula: assinatura,
        });
        setMsg({ kind: 'info', text: 'Resposta registrada offline — sincroniza quando reconectar.' });
      }
      await recarregar();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao responder sugestão' });
    } finally {
      setBusy(false);
    }
  }

  const podeAjusteDescarte = perfil === 'LIDER' || perfil === 'ADMIN';

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">{session.depositoAtivo.nome} · peças avulsas</div>
            <div className="list-sub">
              {resumo.total} peças cadastradas · {resumo.totalItens} itens em estoque · {resumo.comSaldo} com saldo
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Btn variant={tab === 'pecas' ? 'primary' : 'secondary'} className="small" onClick={() => setTab('pecas')}>Peças</Btn>
            <Btn variant={tab === 'sugestoes' ? 'primary' : 'secondary'} className="small" onClick={() => setTab('sugestoes')}>Sugestões</Btn>
          </div>
        </div>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {tab === 'pecas' && (
        <>
          {podeEntrada && !entradaAberta && (
            <Btn onClick={() => setEntradaAberta(true)} style={{ marginBottom: '0.8rem' }}>
              + Registrar entrada de peça
            </Btn>
          )}
          {podeEntrada && entradaAberta && (
            <form onSubmit={registrarEntrada} className="card" style={{ marginBottom: '1rem' }}>
              <h3>Entrada de peça avulsa</h3>
              <Field id="pe-sap" label="Código SAP (do enxoval deste depósito)" value={entSap} onChange={(e) => setEntSap(e.target.value)} placeholder="Ex.: 1002341" required />
              <Field id="pe-desc" label="Descrição" value={entDesc} onChange={(e) => setEntDesc(e.target.value)} required />
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <SelectField id="pe-origem" label="Origem" value={entOrigem} onChange={(e) => setEntOrigem(e.target.value as OrigemSparePart)}>
                    {ORIGENS.map((o) => <option key={o} value={o}>{ORIGEM_SPARE_PART_LABEL[o]}</option>)}
                  </SelectField>
                </div>
                <div style={{ width: '7rem' }}>
                  <Field id="pe-qtd" label="Quantidade" type="number" min="1" value={entQtd} onChange={(e) => setEntQtd(e.target.value)} required />
                </div>
              </div>
              <Field id="pe-obs" label="Observação" value={entObs} onChange={(e) => setEntObs(e.target.value)} placeholder="Opcional" />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Btn type="submit" disabled={busy}>{busy ? 'Registrando…' : online ? 'Registrar entrada' : 'Registrar entrada (offline)'}</Btn>
                <Btn type="button" variant="ghost" onClick={() => setEntradaAberta(false)}>Cancelar</Btn>
              </div>
            </form>
          )}

          <div className="card">
            <h3>Estoque de peças avulsas</h3>
            <Field id="pc-busca" placeholder="Buscar por SAP, descrição ou observação" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="muted" style={{ display: 'inline-flex', gap: '0.4rem', marginTop: '0.4rem' }}>
              <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} />
              Somente com saldo
            </label>
            <div style={{ marginTop: '0.6rem' }}>
              {pecasVisiveis.length === 0 && <div className="list-sub">Nenhuma peça encontrada.</div>}
              {pecasVisiveis.map((p) => (
                <div key={p.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{p.codigoSap} · {p.descricao}</div>
                    <div className="list-sub">
                      saldo <strong>{p.quantidadeAtual}</strong> · {ORIGEM_SPARE_PART_LABEL[p.origem]} · resp. {p.responsavel}
                      {p.observacao ? ` · ${p.observacao}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                    <Btn variant="secondary" className="small" onClick={() => { setMovTipo('SAIDA'); setMovAlvo(p); setMovQtd('1'); setMovMotivo(''); }}>Saída / uso</Btn>
                    {podeAjusteDescarte && (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <Btn variant="ghost" className="small" onClick={() => { setAjusteAlvo(p); setAjusteNovoSaldo(String(p.quantidadeAtual)); setAjusteMotivo(''); }}>Ajustar saldo</Btn>
                        <Btn variant="danger" className="small" onClick={() => { setMovTipo('DESCARTE'); setMovAlvo(p); setMovQtd('1'); setMovMotivo(''); }}>Descartar</Btn>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {movAlvo && (
            <div className="card" style={{ marginTop: '0.8rem' }}>
              <h3>{movTipo === 'DESCARTE' ? 'Descartar peça' : `Movimentação de ${movAlvo.codigoSap}`}</h3>
              <div className="list-sub">
                {movAlvo.descricao} · saldo atual {movAlvo.quantidadeAtual}{online ? '' : ' · offline: vai para a fila'}
              </div>
              {movTipo !== 'DESCARTE' && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <SelectField id="mv-tipo" label="Tipo" value={movTipo}
                      onChange={(e) => setMovTipo(e.target.value as (typeof TIPOS_LIVRES)[number])}>
                      {TIPOS_LIVRES.map((t) => <option key={t} value={t}>{TIPO_MOVIMENTO_PECA_LABEL[t]}</option>)}
                    </SelectField>
                  </div>
                  <div style={{ width: '7rem' }}>
                    <Field id="mv-qtd" label="Quantidade" type="number" min="1" value={movQtd} onChange={(e) => setMovQtd(e.target.value)} required />
                  </div>
                </div>
              )}
              {movTipo === 'DESCARTE' && (
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <div style={{ width: '7rem' }}>
                    <Field id="dc-qtd" label="Quantidade" type="number" min="1" value={movQtd} onChange={(e) => setMovQtd(e.target.value)} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field id="dc-motivo" label="Motivo do descarte" value={movMotivo} onChange={(e) => setMovMotivo(e.target.value)} placeholder="Ex.: material danificado" required />
                  </div>
                </div>
              )}
              {movTipo !== 'DESCARTE' && (
                <Field id="mv-motivo" label="Motivo (opcional)" value={movMotivo} onChange={(e) => setMovMotivo(e.target.value)} />
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <Btn onClick={() => (movTipo === 'DESCARTE' ? void confirmarDescarte() : void confirmarMovimento())} disabled={busy} variant={movTipo === 'DESCARTE' ? 'danger' : 'primary'}>
                  {busy ? 'Processando…' : `Confirmar ${TIPO_MOVIMENTO_PECA_LABEL[movTipo].toLowerCase()}`}
                </Btn>
                <Btn variant="ghost" onClick={() => setMovAlvo(null)}>Cancelar</Btn>
              </div>
            </div>
          )}

          {ajusteAlvo && (
            <div className="card" style={{ marginTop: '0.8rem' }}>
              <h3>Ajuste autorizado · {ajusteAlvo.codigoSap}</h3>
              <div className="list-sub">Saldo atual: {ajusteAlvo.quantidadeAtual} · exige liderança e conexão</div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div style={{ width: '8rem' }}>
                  <Field id="aj-saldo" label="Novo saldo" type="number" min="0" value={ajusteNovoSaldo} onChange={(e) => setAjusteNovoSaldo(e.target.value)} required />
                </div>
                <div style={{ flex: 1 }}>
                  <Field id="aj-motivo" label="Motivo" value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} placeholder="Ex.: contagem física" required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <Btn onClick={() => void confirmarAjuste()} disabled={busy}>Confirmar ajuste</Btn>
                <Btn variant="ghost" onClick={() => setAjusteAlvo(null)}>Cancelar</Btn>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'sugestoes' && (
        <div className="card">
          <h3>Sugestões de conversão peça avulsa → enxoval</h3>
          <div className="list-sub">
            Geradas pelo sistema quando há peça avulsa disponível e o item do enxoval está abaixo da quantidade prevista.
          </div>
          <div style={{ marginTop: '0.6rem' }}>
            {sugestoes.length === 0 && <div className="list-sub">Nenhuma sugestão no momento.</div>}
            {sugestoes.map((s) => (
              <div key={s.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}>
                  <div className="list-title">{s.codigoSap} · {s.descricao}</div>
                  <div className="list-sub">
                    {s.qtdDisponivelPecas} peça(s) avulsa(s) · previsto {s.qtdPrevistaLista} · sugerir {s.qtdSugerida}
                  </div>
                  {s.motivo && <div className="list-sub">{s.motivo}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                  <span className={`chip ${s.status === 'PENDENTE' ? 'warn' : s.status === 'ACEITA' ? 'ok' : 'muted'}`}>
                    {SUGESTAO_STATUS_LABEL[s.status]}
                  </span>
                  {s.status === 'PENDENTE' && podeEntrada && (
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <Btn className="small" disabled={busy} onClick={() => void responderSugestao(s, 'ACEITA')}>Aceitar</Btn>
                      <Btn variant="secondary" className="small" disabled={busy} onClick={() => void responderSugestao(s, 'RECUSADA')}>Recusar</Btn>
                    </div>
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