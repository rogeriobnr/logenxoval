import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ConsumableRow, PpeItemRow, RequestRow, SolicitacaoTipo } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { assinarMatricula } from '../lib/assinatura';
import {
  acoesDaSolicitacao,
  filtrarPorBusca,
  REQUEST_STATUS_LABEL,
  resumoDeEstoque,
  solicitarMarkdown,
  SOLICITACAO_TIPO_LABEL,
  type AcaoSolicitacao,
} from '../lib/estoque';
import {
  listConsumiveisLocal,
  listPpeLocal,
  listRequestsLocal,
  registrarEntradaEstoqueOffline,
  registrarSolicitacaoOffline,
  registrarTransicaoSolicitacaoOffline,
} from '../repos/local';
import { espelharEstoque } from '../services/sync';

export type TabEstoque = 'consumiveis' | 'epis' | 'solicitacoes';

const TIPO_TAB: Record<string, SolicitacaoTipo> = {
  consumiveis: 'CONSUMIVEL',
  epis: 'EPI',
};

export function EstoqueScreen({ inicial = 'consumiveis' }: { inicial?: TabEstoque }) {
  const { api, session, online, deviceId } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<TabEstoque>(inicial);
  const [busy, setBusy] = useState(false);
  const [transBusy, setTransBusy] = useState(false);

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const usuarioId = session?.userId ?? '';
  const podeEntrada = perfil === 'LIDER' || perfil === 'ADMIN';

  const [consumiveis, setConsumiveis] = useState<ConsumableRow[]>([]);
  const [ppe, setPpe] = useState<PpeItemRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [buscaEstoque, setBuscaEstoque] = useState('');
  const [buscaSol, setBuscaSol] = useState('');

  // Nova solicitação
  const [novaAberta, setNovaAberta] = useState(false);
  const [qtds, setQtds] = useState<Record<string, string>>({});

  // Entrada (recebimento) de consumível/EPI — Líder/Admin
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [entCodigo, setEntCodigo] = useState('');
  const [entDescricao, setEntDescricao] = useState('');
  const [entUnidade, setEntUnidade] = useState('');
  const [entMinimo, setEntMinimo] = useState('');
  const [entQtd, setEntQtd] = useState('');
  const [entObservacao, setEntObservacao] = useState('');
  const [entBusy, setEntBusy] = useState(false);

  // Filtro de tipo nas solicitações (Todas/Consumíveis/EPIs)
  const [fTipoSol, setFTipoSol] = useState<'TODAS' | SolicitacaoTipo>('TODAS');

  // Transição
  const [transAlvo, setTransAlvo] = useState<{ req: RequestRow; acao: AcaoSolicitacao } | null>(null);
  const [transPin, setTransPin] = useState('');
  const [transMotivo, setTransMotivo] = useState('');

  // Compartilhar markdown
  const [shareAlvo, setShareAlvo] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!depositoId) return;
    if (online) {
      try {
        await espelharEstoque(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    setConsumiveis(await listConsumiveisLocal(depositoId));
    setPpe(await listPpeLocal(depositoId));
    setRequests(await listRequestsLocal(depositoId));
  }, [api, depositoId, online]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  useEffect(() => {
    setTab(inicial);
  }, [inicial]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para acessar consumíveis e EPIs.</Alert>;
  }

  const itensVisiveis = tab === 'consumiveis'
    ? filtrarPorBusca(consumiveis, buscaEstoque, (r) => `${r.codigo} ${r.descricao}`)
    : filtrarPorBusca(ppe, buscaEstoque, (r) => `${r.codigo} ${r.descricao}`);
  const requestsVisiveis = filtrarPorBusca(
    requests,
    buscaSol,
    (r) => `${r.matricula} ${SOLICITACAO_TIPO_LABEL[r.tipo]} ${r.itens.map((i) => i.codigo).join(' ')}`,
  );
  const requestsFiltradas = fTipoSol === 'TODAS' ? requestsVisiveis : requestsVisiveis.filter((r) => r.tipo === fTipoSol);
  const solicitacoesConsumiveis = requestsFiltradas.filter((r) => r.tipo === 'CONSUMIVEL');
  const solicitacoesEpi = requestsFiltradas.filter((r) => r.tipo === 'EPI');

  const renderRequisicao = (req: RequestRow) => {
    const acoes = acoesDaSolicitacao(req, perfil, usuarioId);
    return (
      <div key={req.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1 }}>
          <div className="list-title">
            {SOLICITACAO_TIPO_LABEL[req.tipo]} · {req.matricula} · {new Date(req.dataEm).toLocaleString('pt-BR')}
          </div>
          <div className="list-sub">
            {req.itens.map((i) => `${i.qtd}x ${i.codigo} ${i.descricao}`).join(' · ') || 'sem itens'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
          <span className={`chip ${req.status === 'CANCELADA' ? 'muted' : req.status === 'APROVADA' || req.status === 'ATENDIDA' ? 'ok' : 'warn'}`}>
            {REQUEST_STATUS_LABEL[req.status]}
          </span>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {acoes.length > 0 && (
              <Btn variant="secondary" className="small" onClick={() => { setTransAlvo({ req, acao: acoes[0] }); setTransPin(''); setTransMotivo(''); }}>
                {acoes[0].rotulo}
              </Btn>
            )}
            <Btn variant="ghost" className="small" onClick={() => void compartilhar(req)}>Compartilhar</Btn>
          </div>
        </div>
      </div>
    );
  };
  const resumoC = resumoDeEstoque(consumiveis);
  const resumoP = resumoDeEstoque(ppe);

  const criarSolicitacao = async (e: FormEvent) => {
    e.preventDefault();
    const tipo = TIPO_TAB[tab];
    if (!tipo) return;
    const selecionados = itensVisiveis
      .map((r) => ({ codigo: r.codigo, descricao: r.descricao, qtd: Number(qtds[r.id] ?? '') }))
      .filter((i) => i.qtd > 0);
    if (selecionados.length === 0) {
      toast.error('Informe a quantidade de ao menos um item.');
      return;
    }
    setBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      if (online) {
        await api.request<{ solicitacao: RequestRow }>(
          'POST',
          `/deposits/${depositoId}/requests`,
          {
            operationId: crypto.randomUUID(),
            tipo,
            itens: selecionados,
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        toast.success('Solicitação criada.');
      } else {
        await registrarSolicitacaoOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          tipo,
          itens: selecionados,
          solicitanteId: session.userId,
          matricula: session.matricula,
          assinaturaMatricula: assinatura,
        });
        toast.info('Solicitação criada offline — sincroniza quando reconectar.');
      }
      setNovaAberta(false);
      setQtds({});
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar solicitação');
    } finally {
      setBusy(false);
    }
  };

  const preencherEntrada = () => {
    const codigo = entCodigo.trim().toUpperCase();
    if (!codigo) return;
    const base = tab === 'consumiveis' ? consumiveis : ppe;
    const achado = base.find((r) => r.codigo.trim().toUpperCase() === codigo);
    if (achado) {
      setEntDescricao(achado.descricao);
      setEntUnidade(achado.unidade === 'unidade' ? '' : achado.unidade);
      setEntMinimo(String(achado.estoqueMinimo));
    }
  };

  const registrarEntrada = async (e: FormEvent) => {
    e.preventDefault();
    if (!podeEntrada) {
      toast.error('Entrada de consumível/EPI exige perfil Líder ou Admin.');
      return;
    }
    const tipo = TIPO_TAB[tab];
    if (!tipo) return;
    const codigo = entCodigo.trim().toUpperCase();
    if (!codigo) {
      toast.error('Informe o código do item.');
      return;
    }
    const qty = Number(entQtd);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Quantidade precisa ser maior que zero.');
      return;
    }
    if (!entDescricao.trim()) {
      toast.error('Informe a descrição do item.');
      return;
    }
    setEntBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const observacao = entObservacao.trim() || undefined;
      const unidade = entUnidade.trim() || undefined;
      const estoqueMinimo = entMinimo.trim() ? Number(entMinimo) : undefined;
      if (online) {
        const res = await api.request<{ saldo: number; criado: boolean; jaProcessada: boolean }>(
          'POST',
          `/deposits/${depositoId}/estoque/entrada`,
          {
            operationId: crypto.randomUUID(),
            tipo,
            codigo,
            descricao: entDescricao.trim(),
            unidade,
            estoqueMinimo,
            quantidade: qty,
            observacao,
            origem: 'ONLINE',
            dispositivo: deviceId,
            dataHora: new Date().toISOString(),
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        toast.success(
          res.jaProcessada
            ? 'Operação já processada anteriormente (idempotente).'
            : `Entrada registrada${res.criado ? ' · item criado no catálogo' : ''}. Saldo atual: ${res.saldo}`,
        );
      } else {
        await registrarEntradaEstoqueOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          tipo,
          codigo,
          descricao: entDescricao.trim(),
          unidade,
          estoqueMinimo,
          quantidade: qty,
          observacao,
          dataHora: new Date().toISOString(),
          usuarioId: session.userId,
          matricula: session.matricula,
          dispositivo: deviceId,
          assinaturaMatricula: assinatura,
        });
        toast.info('Entrada registrada offline — sincroniza quando reconectar.');
      }
      setEntradaAberta(false);
      setEntCodigo('');
      setEntDescricao('');
      setEntUnidade('');
      setEntMinimo('');
      setEntQtd('');
      setEntObservacao('');
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao registrar entrada');
    } finally {
      setEntBusy(false);
    }
  };

  const confirmarTransicao = async () => {
    if (!transAlvo) return;
    const { req, acao } = transAlvo;
    if (!online && req.id.startsWith('local:')) {
      toast.error('Sincronize primeiro — essa solicitação ainda não existe no servidor.');
      return;
    }
    const pin = acao.precisaPin ? transPin.trim() : undefined;
    if (acao.precisaPin && !pin) {
      toast.error('Informe o PIN administrativo para aprovar/atender.');
      return;
    }
    setTransBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      if (online) {
        await api.request<{ solicitacao: RequestRow }>(
          'POST',
          `/deposits/${depositoId}/requests/${req.id}/transition`,
          {
            operationId: crypto.randomUUID(),
            para: acao.para,
            motivo: transMotivo.trim() || undefined,
            ...(pin ? { pin } : {}),
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        toast.success('Transição registrada.');
      } else {
        await registrarTransicaoSolicitacaoOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          requestId: req.id,
          para: acao.para,
          motivo: transMotivo.trim() || undefined,
          pin,
          assinaturaMatricula: assinatura,
        });
        toast.info('Transição registrada offline — valida na sincronização.');
      }
      setTransAlvo(null);
      setTransPin('');
      setTransMotivo('');
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha na transição');
    } finally {
      setTransBusy(false);
    }
  };

  const compartilhar = async (req: RequestRow) => {
    const texto = solicitarMarkdown(req);
    if (online && navigator.share) {
      try {
        await navigator.share({ title: 'Solicitação', text: texto });
        return;
      } catch {
        // fallback para cópia
      }
    }
    setShareAlvo(texto);
  };

  const copiarMarkdown = async () => {
    if (!shareAlvo) return;
    try {
      await navigator.clipboard.writeText(shareAlvo);
      toast.success('Texto copiado.');
    } catch {
      toast.error('Falha ao copiar. Copie manualmente do campo abaixo.');
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">{session.depositoAtivo.nome} · consumíveis e EPIs</div>
            <div className="list-sub">
              Consumíveis: {resumoC.totalItens} itens · {resumoC.totalUnidades} un. · {resumoC.abaixoMinimo} abaixo do mínimo
              · EPIs: {resumoP.totalItens} itens · {resumoP.totalUnidades} un. · {resumoP.abaixoMinimo} abaixo do mínimo
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Btn variant={tab === 'consumiveis' ? 'primary' : 'secondary'} className="small" onClick={() => setTab('consumiveis')}>Consumíveis</Btn>
            <Btn variant={tab === 'epis' ? 'primary' : 'secondary'} className="small" onClick={() => setTab('epis')}>EPIs</Btn>
            <Btn variant={tab === 'solicitacoes' ? 'primary' : 'secondary'} className="small" onClick={() => setTab('solicitacoes')}>Solicitações</Btn>
          </div>
        </div>
      </div>

      {tab !== 'solicitacoes' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="list-item" style={{ flexWrap: 'wrap' }}>
            <Field id="busca-estoque" placeholder="Buscar por código ou descrição" value={buscaEstoque} onChange={(e) => setBuscaEstoque(e.target.value)} />
            {!novaAberta && !entradaAberta && (
              <>
                {podeEntrada && (
                  <Btn variant="secondary" onClick={() => setEntradaAberta(true)}>+ Entrada (recepção)</Btn>
                )}
                <Btn onClick={() => setNovaAberta(true)}>+ Solicitar {TIPO_TAB[tab] === 'CONSUMIVEL' ? 'consumíveis' : 'EPIs'}</Btn>
              </>
            )}
          </div>
          {entradaAberta && (
            <form onSubmit={registrarEntrada} style={{ marginTop: '0.6rem' }}>
              <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
                Recebimento de {SOLICITACAO_TIPO_LABEL[TIPO_TAB[tab]].toLowerCase()}. Se o código ainda não estiver no catálogo, o item é criado na entrada.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.4rem' }}>
                <Field id="ent-codigo" label="Código do item" value={entCodigo} onChange={(e) => setEntCodigo(e.target.value)} onBlur={() => preencherEntrada()} required />
                <Field id="ent-desc" label="Descrição" value={entDescricao} onChange={(e) => setEntDescricao(e.target.value)} required />
                <Field id="ent-qtd" label="Quantidade" type="number" min="0" value={entQtd} onChange={(e) => setEntQtd(e.target.value)} required />
                <Field id="ent-un" label="Unidade" value={entUnidade} onChange={(e) => setEntUnidade(e.target.value)} placeholder="ex.: caixa, litro" />
                <Field id="ent-min" label="Estoque mínimo" type="number" min="0" value={entMinimo} onChange={(e) => setEntMinimo(e.target.value)} />
              </div>
              <Field id="ent-obs" label="Observação" value={entObservacao} onChange={(e) => setEntObservacao(e.target.value)} placeholder="Opcional (ex.: NF 12345)" />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <Btn type="submit" disabled={entBusy}>{entBusy ? 'Registrando…' : online ? 'Registrar entrada' : 'Registrar (offline — vai para a fila)'}</Btn>
                <Btn variant="ghost" onClick={() => setEntradaAberta(false)}>Cancelar</Btn>
              </div>
            </form>
          )}
          {novaAberta && (
            <form onSubmit={criarSolicitacao} style={{ marginTop: '0.6rem' }}>
              <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
                Informe a quantidade desejada dos itens e crie a solicitação de {SOLICITACAO_TIPO_LABEL[TIPO_TAB[tab]].toLowerCase()}.
              </div>
              {itensVisiveis.length === 0 && <div className="list-sub">Nenhum item de {tab} com estoque espelhado.</div>}
              {itensVisiveis.map((r) => (
                <div key={r.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{r.codigo} · {r.descricao}</div>
                    <div className="list-sub">em estoque {r.estoqueAtual} {r.unidade} · mínimo {r.estoqueMinimo}</div>
                  </div>
                  <div style={{ width: '7rem' }}>
                    <Field id={`qtd-${r.id}`} label="Qtd" type="number" min="0" value={qtds[r.id] ?? ''} onChange={(e) => setQtds({ ...qtds, [r.id]: e.target.value })} />
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <Btn type="submit" disabled={busy}>{busy ? 'Criando…' : online ? `Criar solicitação de ${SOLICITACAO_TIPO_LABEL[TIPO_TAB[tab]].toLowerCase()}` : 'Criar (offline — vai para a fila)'}</Btn>
                <Btn variant="ghost" onClick={() => setNovaAberta(false)}>Cancelar</Btn>
              </div>
            </form>
          )}
          {!novaAberta && !entradaAberta && (
            <div style={{ marginTop: '0.4rem' }}>
              {itensVisiveis.length === 0 && <div className="list-sub">Nenhum item encontrado.</div>}
              {itensVisiveis.map((r) => (
                <div key={r.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{r.codigo} · {r.descricao}</div>
                    <div className="list-sub">
                      em estoque <strong>{r.estoqueAtual}</strong> {r.unidade} · mínimo {r.estoqueMinimo}
                    </div>
                  </div>
                  {r.estoqueAtual < r.estoqueMinimo && <span className="chip warn">abaixo do mínimo</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'solicitacoes' && (
        <div className="card">
          <h3>Solicitações</h3>
          <Field id="busca-sol" placeholder="Buscar por matrícula, tipo ou item" value={buscaSol} onChange={(e) => setBuscaSol(e.target.value)} />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
            {(['TODAS', 'CONSUMIVEL', 'EPI'] as const).map((t) => {
              const label = t === 'TODAS' ? 'Todas' : SOLICITACAO_TIPO_LABEL[t] + 's';
              return (
                <Btn
                  key={t}
                  variant={fTipoSol === t ? 'primary' : 'ghost'}
                  className="small"
                  onClick={() => setFTipoSol(t)}
                >
                  {label}
                </Btn>
              );
            })}
          </div>
          <div style={{ marginTop: '0.6rem' }}>
            {requestsFiltradas.length === 0 && <div className="list-sub">Nenhuma solicitação encontrada.</div>}
            {solicitacoesConsumiveis.length > 0 && (
              <h4 style={{ margin: '0.6rem 0 0.3rem' }}>Consumíveis</h4>
            )}
            {solicitacoesConsumiveis.map(renderRequisicao)}
            {solicitacoesEpi.length > 0 && (
              <h4 style={{ margin: '0.8rem 0 0.3rem' }}>EPIs</h4>
            )}
            {solicitacoesEpi.map(renderRequisicao)}
          </div>
        </div>
      )}

      {shareAlvo && (
        <div className="card" style={{ marginTop: '0.8rem' }}>
          <h3>Compartilhar solicitação (texto copiável)</h3>
          <div className="field">
            <textarea readOnly rows={8} value={shareAlvo} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn onClick={() => void copiarMarkdown()}>Copiar</Btn>
            <Btn variant="ghost" onClick={() => setShareAlvo(null)}>Fechar</Btn>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={transAlvo !== null}
        title={transAlvo ? `${transAlvo.acao.rotulo} · ${transAlvo.req.id.slice(0, 8).toUpperCase()}` : ''}
        message={transAlvo
          ? `${SOLICITACAO_TIPO_LABEL[transAlvo.req.tipo]} · status atual ${REQUEST_STATUS_LABEL[transAlvo.req.status]}${transAlvo.acao.precisaPin ? ' · exige PIN administrativo' : ''}${!online ? ' · offline: segue para a fila' : ''}`
          : ''}
        confirmLabel={transAlvo ? `Confirmar: ${REQUEST_STATUS_LABEL[transAlvo.acao.para].toLowerCase()}` : ''}
        danger={transAlvo?.acao.para === 'CANCELADA'}
        busy={transBusy}
        onConfirm={() => void confirmarTransicao()}
        onCancel={() => { setTransAlvo(null); setTransPin(''); setTransMotivo(''); }}
      >
        {transAlvo?.acao.precisaPin && (
          <Field
            id="trans-pin"
            label="PIN administrativo"
            type="password"
            inputMode="numeric"
            value={transPin}
            onChange={(e) => setTransPin(e.target.value)}
            placeholder="●●●●"
          />
        )}
        {transAlvo?.acao.para === 'CANCELADA' && (
          <Field id="trans-motivo" label="Motivo" value={transMotivo} onChange={(e) => setTransMotivo(e.target.value)} placeholder="Opcional" />
        )}
      </ConfirmDialog>
    </div>
  );
}