import { useCallback, useEffect, useState } from 'react';
import type { SyncQueueRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { navigate } from '../router';
import { onSync } from '../lib/events';
import {
  ENTIDADE_FILA_LABEL,
  orientacaoParaErro,
  resumoOperacaoFila,
} from '../lib/filaErros';
import {
  listOperacoesComErro,
  reativarOperacaoFila,
  removerDaFila,
} from '../repos/local';
import { SyncModal } from '../components/SyncModal';

function quando(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/**
 * Fase 22: tratamento dos erros da fila de sincronização. Sem esta tela o
 * usuário só via a contagem no dashboard e não sabia o que fazer.
 */
export function SyncQueueScreen() {
  const { session, online } = useAuth();
  const toast = useToast();
  const depositoId = session?.depositoAtivo?.id;
  const [erros, setErros] = useState<SyncQueueRow[]>([]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [descartando, setDescartando] = useState<SyncQueueRow | null>(null);
  const [descartandoTodos, setDescartandoTodos] = useState(false);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setErros(await listOperacoesComErro(depositoId));
  }, [depositoId]);

  useEffect(() => {
    void carregar();
    return onSync(() => void carregar());
  }, [carregar]);

  const reenviar = async (q: SyncQueueRow) => {
    await reativarOperacaoFila(q.operationId);
    toast.success('Operação liberada para o próximo envio. Rode “Sincronizar agora”.');
    await carregar();
  };

  const reenviarTodas = async () => {
    setBusy(true);
    try {
      for (const q of erros) await reativarOperacaoFila(q.operationId);
      toast.success(`${erros.length} operação(ões) liberadas para reenvio.`);
      await carregar();
    } finally {
      setBusy(false);
    }
  };

  const descartar = async (q: SyncQueueRow) => {
    setBusy(true);
    try {
      await removerDaFila(q.operationId);
      toast.success('Operação descartada. Ela não será mais enviada.');
      setDescartando(null);
      await carregar();
    } finally {
      setBusy(false);
    }
  };

  const descartarTodas = async () => {
    setBusy(true);
    try {
      for (const q of erros) await removerDaFila(q.operationId);
      toast.success('Todas as operações com erro foram descartadas.');
      setDescartandoTodos(false);
      await carregar();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="screen-title">Fila de sincronização</h2>

      {!online && (
        <Alert kind="warn">
          Sem conexão. As operações com erro permanecem salvas aqui e voltam a ser tentadas quando a internet voltar.
        </Alert>
      )}

      {erros.length === 0 ? (
        <div className="card">
          <div className="list-item" style={{ borderBottom: 'none' }}>
            <div>
              <div className="list-title ok">Nenhum erro na fila</div>
              <div className="list-sub">Tudo que você registrou está no servidor.</div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="list-item">
              <div>
                <div className="list-title warn">{erros.length} operação(ões) recusada(s)</div>
                <div className="list-sub">
                  O servidor recusou e elas pararam de tentar sozinhas. Leia a causa abaixo: se for algo transitório,
                  reenvie; se o registro não faz mais sentido, descarte.
                </div>
              </div>
            </div>
            <div className="list-item" style={{ borderBottom: 'none', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Btn onClick={() => setSyncOpen(true)} disabled={!online}>
                ⟳ Sincronizar agora
              </Btn>
              <Btn variant="secondary" onClick={() => void reenviarTodas()} disabled={busy}>
                Reenviar todas
              </Btn>
              <Btn variant="danger" onClick={() => setDescartandoTodos(true)} disabled={busy}>
                Descartar todas
              </Btn>
            </div>
          </div>

          {erros.map((q) => {
            const dica = orientacaoParaErro(q.erro);
            return (
              <div className="card" key={q.operationId} style={{ marginBottom: '0.6rem' }}>
                <div className="list-item">
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{ENTIDADE_FILA_LABEL[q.entidade] ?? q.entidade}</div>
                    <div className="list-sub">{resumoOperacaoFila(q)}</div>
                    <div className="list-sub">
                      {q.tentativas} tentativa(s) · criado {quando(q.criadoEm)}
                    </div>
                  </div>
                  <span className="chip warn">erro</span>
                </div>
                <div className="list-item" style={{ borderBottom: 'none' }}>
                  <div>
                    <div className="list-title">{dica.titulo}</div>
                    <div className="list-sub">{q.erro ?? 'Sem detalhe do servidor.'}</div>
                    <div className="list-sub" style={{ marginTop: '0.3rem' }}>
                      <b>O que fazer:</b> {dica.orientacao}
                    </div>
                  </div>
                </div>
                <div className="list-item" style={{ borderBottom: 'none', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Btn variant="secondary" className="small" onClick={() => void reenviar(q)} disabled={busy}>
                    Reenviar esta
                  </Btn>
                  <Btn variant="danger" className="small" onClick={() => setDescartando(q)} disabled={busy}>
                    Descartar
                  </Btn>
                  <Btn variant="ghost" className="small" onClick={() => navigate('/configuracoes')}>
                    Verificar dados
                  </Btn>
                </div>
              </div>
            );
          })}
        </>
      )}

      <Btn variant="ghost" onClick={() => navigate('/')}>
        Voltar
      </Btn>

      <SyncModal
        open={syncOpen}
        onClose={() => {
          setSyncOpen(false);
          void carregar();
        }}
      />

      <ConfirmDialog
        open={descartando !== null}
        title="Descartar operação"
        message={
          descartando
            ? `Descartar "${ENTIDADE_FILA_LABEL[descartando.entidade] ?? descartando.entidade}"? O registro local também é removido e não poderá ser reenviado.`
            : undefined
        }
        confirmLabel="Descartar"
        danger
        busy={busy}
        onConfirm={() => descartando && void descartar(descartando)}
        onCancel={() => setDescartando(null)}
      />

      <ConfirmDialog
        open={descartandoTodos}
        title="Descartar todas as operações com erro"
        message={`Descartar ${erros.length} operação(ões)? Tudo que está na fila com erro será perdido e não poderá ser reenviado.`}
        confirmLabel="Descartar todas"
        danger
        busy={busy}
        onConfirm={() => void descartarTodas()}
        onCancel={() => setDescartandoTodos(false)}
      />
    </div>
  );
}
