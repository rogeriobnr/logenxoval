import { useCallback, useEffect, useState } from 'react';
import type { RequestRow, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { assinarMatricula } from '../lib/assinatura';
import {
  acoesDaSolicitacao,
  filtrarPorBusca,
  itensNoCatalogo,
  REQUEST_STATUS_LABEL,
  SOLICITACAO_TIPO_LABEL,
  type AcaoSolicitacao,
} from '../lib/estoque';
import {
  listConsumiveisLocal,
  listPpeLocal,
  listRequestsLocal,
  registrarTransicaoSolicitacaoOffline,
} from '../repos/local';
import { espelharEstoque } from '../services/sync';

/**
 * Fase 21: tela dedicada de solicitações. As solicitações nascem ENVIADAS na
 * tela de cada catálogo (Consumíveis/EPIs). Aqui ficam listadas com o filtro
 * por tipo e as transições: marcar recebida (com itens não recebidos) e excluir.
 */
export function SolicitacoesScreen() {
  const { api, session, online } = useAuth();
  const toast = useToast();
  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const usuarioId = session?.userId ?? '';

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [codigosCatalogo, setCodigosCatalogo] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [fTipo, setFTipo] = useState<'TODAS' | SolicitacaoTipo>('TODAS');
  const [transBusy, setTransBusy] = useState(false);
  const [transAlvo, setTransAlvo] = useState<{ req: RequestRow; acao: AcaoSolicitacao } | null>(null);
  const [transMotivo, setTransMotivo] = useState('');
  const [naoRecebSel, setNaoRecebSel] = useState<Record<string, boolean>>({});

  const recarregar = useCallback(async () => {
    if (!depositoId) return;
    if (online) {
      try {
        await espelharEstoque(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    setRequests(await listRequestsLocal(depositoId));
    const [cons, ppe] = await Promise.all([listConsumiveisLocal(depositoId), listPpeLocal(depositoId)]);
    setCodigosCatalogo(new Set([...cons.map((c) => c.codigo), ...ppe.map((p) => p.codigo)]));
  }, [api, depositoId, online]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para ver as solicitações.</Alert>;
  }

  const minhas = requests.filter((r) => perfil !== 'MECANICO' || r.solicitanteId === usuarioId);
  const noCatalogo = minhas.filter((r) => itensNoCatalogo(r.itens, codigosCatalogo).length > 0);
  const visiveis = filtrarPorBusca(
    noCatalogo,
    busca,
    (r) => `${r.matricula} ${SOLICITACAO_TIPO_LABEL[r.tipo]} ${r.itens.map((i) => i.codigo).join(' ')}`,
  );
  const filtradas = fTipo === 'TODAS' ? visiveis : visiveis.filter((r) => r.tipo === fTipo);

  const executarTransicao = async (
    req: RequestRow,
    para: RequestStatus,
    extras?: { motivo?: string; naoRecebidos?: string[] },
  ) => {
    if (!online && req.id.startsWith('local:')) {
      toast.error('Sincronize primeiro — essa solicitação ainda não existe no servidor.');
      return;
    }
    setTransBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      if (online) {
        await api.request(
          'POST',
          `/deposits/${depositoId}/requests/${req.id}/transition`,
          {
            operationId: crypto.randomUUID(),
            para,
            motivo: extras?.motivo,
            naoRecebidos: extras?.naoRecebidos,
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
          para,
          motivo: extras?.motivo,
          naoRecebidos: extras?.naoRecebidos,
          assinaturaMatricula: assinatura,
        });
        toast.info('Transição registrada offline — valida na sincronização.');
      }
      setTransAlvo(null);
      setTransMotivo('');
      setNaoRecebSel({});
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha na transição');
    } finally {
      setTransBusy(false);
    }
  };

  const confirmarTransicao = async () => {
    if (!transAlvo) return;
    const { req, acao } = transAlvo;
    const naoRecebidos = acao.para === 'RECEBIDA'
      ? req.itens.filter((i) => naoRecebSel[i.codigo]).map((i) => i.codigo)
      : undefined;
    await executarTransicao(req, acao.para, {
      motivo: transMotivo.trim() || undefined,
      ...(naoRecebidos && naoRecebidos.length > 0 ? { naoRecebidos } : {}),
    });
  };

  const renderRequisicao = (req: RequestRow) => {
    const acoes = acoesDaSolicitacao(req, perfil, usuarioId);
    const itens = itensNoCatalogo(req.itens, codigosCatalogo);
    const itensTexto = req.status === 'RECEBIDA'
      ? itens
          .map((i) => (i.recebido === false ? `${i.qtd}x ${i.codigo} ✗` : `${i.qtd}x ${i.codigo} ✓`))
          .join(' · ')
      : itens.map((i) => `${i.qtd}x ${i.codigo} ${i.descricao}`).join(' · ') || 'sem itens';
    return (
      <div key={req.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1 }}>
          <div className="list-title">
            {SOLICITACAO_TIPO_LABEL[req.tipo]} · {req.matricula} · {new Date(req.dataEm).toLocaleString('pt-BR')}
          </div>
          <div className="list-sub">{itensTexto}</div>
          {req.status === 'RECEBIDA' && itens.some((i) => i.recebido === false) && (
            <div className="list-sub">Há itens que não foram recebidos.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
          <span className={`chip ${req.status === 'RASCUNHO' ? 'warn' : req.status === 'ENVIADA' ? 'primary' : req.status === 'RECEBIDA' ? 'ok' : 'muted'}`}>
            {REQUEST_STATUS_LABEL[req.status]}
          </span>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {acoes.map((acao) => (
              <Btn
                key={acao.para}
                variant={acao.danger ? 'danger' : 'secondary'}
                className="small"
                onClick={() => { setTransAlvo({ req, acao }); setTransMotivo(''); setNaoRecebSel({}); }}
              >
                {acao.rotulo}
              </Btn>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 className="screen-title">Solicitações</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">{session.depositoAtivo.nome}</div>
            <div className="list-sub">Solicitações registradas: {noCatalogo.length}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <Field id="busca-sol" placeholder="Buscar por matrícula, tipo ou item" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
          {(['TODAS', 'CONSUMIVEL', 'EPI'] as const).map((t) => {
            const label = t === 'TODAS' ? 'Todas' : `${SOLICITACAO_TIPO_LABEL[t]}`;
            return (
              <Btn key={t} variant={fTipo === t ? 'primary' : 'ghost'} className="small" onClick={() => setFTipo(t)}>
                {label}
              </Btn>
            );
          })}
        </div>
        <div style={{ marginTop: '0.6rem' }}>
          {filtradas.length === 0 && <div className="list-sub">Nenhuma solicitação encontrada.</div>}
          {filtradas.map(renderRequisicao)}
        </div>
      </div>

      <ConfirmDialog
        open={transAlvo !== null}
        title={transAlvo ? `${transAlvo.acao.rotulo} · ${transAlvo.req.id.slice(0, 8).toUpperCase()}` : ''}
        message={transAlvo
          ? `${SOLICITACAO_TIPO_LABEL[transAlvo.req.tipo]} · status atual ${REQUEST_STATUS_LABEL[transAlvo.req.status]}${!online ? ' · offline: segue para a fila' : ''}`
          : ''}
        confirmLabel={transAlvo ? `Confirmar: ${REQUEST_STATUS_LABEL[transAlvo.acao.para].toLowerCase()}` : ''}
        danger={transAlvo?.acao.danger === true}
        busy={transBusy}
        onConfirm={() => void confirmarTransicao()}
        onCancel={() => { setTransAlvo(null); setTransMotivo(''); setNaoRecebSel({}); }}
      >
        {transAlvo?.acao.para === 'RECEBIDA' && (
          <div>
            <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
              Marque os itens que <strong>não</strong> foram recebidos:
            </div>
            {transAlvo.req.itens.map((i) => (
              <label key={i.codigo} className="list-item" style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }} htmlFor={`nao-rec-${i.codigo}`}>
                <input
                  id={`nao-rec-${i.codigo}`}
                  type="checkbox"
                  style={{ marginRight: '0.6rem' }}
                  checked={naoRecebSel[i.codigo] ?? false}
                  onChange={(e) => setNaoRecebSel({ ...naoRecebSel, [i.codigo]: e.target.checked })}
                />
                <div>
                  <div className="list-title">{i.codigo}</div>
                  <div className="list-sub">{i.qtd}x {i.descricao}</div>
                </div>
              </label>
            ))}
          </div>
        )}
        {transAlvo?.acao.para === 'EXCLUIDA' && (
          <Field id="trans-motivo" label="Motivo" value={transMotivo} onChange={(e) => setTransMotivo(e.target.value)} placeholder="Opcional" />
        )}
      </ConfirmDialog>
    </div>
  );
}
