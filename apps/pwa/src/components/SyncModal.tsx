import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { espelharDepositos, type SyncFase, type SyncProgresso } from '../services/sync';
import { Btn } from './ui';
import { Modal } from './Modal';
import { useToast } from './Toasts';

interface StepLine {
  message: string;
  ok?: boolean;
  fail?: boolean;
}

const FASE_ICONE: Record<SyncFase, string> = {
  CONEXAO: '⟳',
  DEPOSITOS: '▤',
  BAIXAS: '↑',
  DOCUMENTOS: '🖼',
  ESPELHO: '↓',
  FINALIZANDO: '✓',
  CONCLUIDA: '✔',
  FALHA: '✕',
};

export function SyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, deviceId, online } = useAuth();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepLine[]>([]);
  const [progresso, setProgresso] = useState<SyncProgresso>({ fase: 'CONEXAO', percentual: 0, mensagem: '' });
  const ultimoPct = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    const run = async () => {
      setRunning(true);
      setSteps([]);
      ultimoPct.current = 0;
      setProgresso({ fase: 'CONEXAO', percentual: 0, mensagem: '' });
      if (!online) {
        setSteps([{ message: 'Sem conexão — operações mantidas pendentes no dispositivo.' }]);
        setProgresso({ fase: 'FALHA', percentual: 0, mensagem: 'Sem conexão com o servidor' });
        setRunning(false);
        return;
      }
      try {
        const res = await espelharDepositos({
          api,
          deviceId,
          onProgress: (p) => {
            if (cancel) return;
            ultimoPct.current = p.percentual;
            setProgresso(p);
            if (p.fase === 'CONCLUIDA') {
              setSteps((prev) => [...prev, { message: p.mensagem, ok: true }]);
            } else {
              setSteps((prev) => [...prev, { message: p.mensagem }]);
            }
          },
        });
        if (!cancel && res.errosFila > 0) {
          toast.error(`${res.errosFila} operação(ões) falharam. Veja a Fila de sincronização.`);
        }
      } catch (err) {
        if (!cancel) {
          const msg = err instanceof Error ? err.message : 'Erro de sincronização.';
          toast.error(msg);
          setProgresso({ fase: 'FALHA', percentual: ultimoPct.current, mensagem: msg });
          setSteps((prev) => [...prev, { message: msg, fail: true }]);
        }
      } finally {
        if (!cancel) setRunning(false);
      }
    };
    void run();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api, deviceId, online, toast]);

  const fechar = () => {
    if (running) return;
    onClose();
  };

  const pct = running ? Math.min(99, progresso.percentual) : progresso.percentual;
  const concluido = !running && progresso.fase === 'CONCLUIDA';
  const falhou = !running && progresso.fase === 'FALHA';

  return (
    <Modal open={open} title="Sincronizando com o servidor" onClose={fechar}>
      <div style={{ marginBottom: '1rem' }}>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: '12px',
            borderRadius: '999px',
            background: 'var(--line)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: '999px',
              background: falhou ? 'var(--warn)' : 'var(--primary, var(--ok))',
              transition: 'width 320ms ease-out',
              ...(running ? {
                backgroundImage:
                  'linear-gradient(115deg, rgba(255,255,255,0.28) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.28) 75%, transparent 75%)',
                backgroundSize: '22px 22px',
                animation: 'sync-stripes 700ms linear infinite',
              } : {}),
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginTop: '0.4rem',
            gap: '0.5rem',
          }}
        >
          <span className="list-sub" aria-live="polite">
            {running ? `${FASE_ICONE[progresso.fase]} ${progresso.mensagem || 'Iniciando…'}` : progresso.mensagem}
          </span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</strong>
        </div>
        <style>{`@keyframes sync-stripes { from { background-position: 0 0; } to { background-position: 22px 0; } }
@keyframes sync-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }`}</style>
      </div>

      <div
        aria-busy={running}
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '0.4rem 0 0.6rem',
          opacity: running ? 1 : 0,
          transition: 'opacity 200ms',
          animation: running ? 'sync-pulse 1.1s ease-in-out infinite' : undefined,
        }}
      >
        <span className="muted" style={{ letterSpacing: '0.2em' }}>
          ⟳ sincronizando…
        </span>
      </div>

      <div style={{ maxHeight: '14rem', overflowY: 'auto' }}>
        {steps.map((s, i) => (
          <div key={i} className="list-item" style={{ borderBottom: 'none', padding: '0.3rem 0' }}>
            <span aria-hidden style={{ marginRight: '0.5rem' }}>
              {s.fail ? '✕' : s.ok ? '✔' : '•'}
            </span>
            <span style={{ flex: 1 }}>{s.message}</span>
            {s.ok && (
              <span style={{ color: 'var(--ok)' }} aria-label="concluído">
                ok
              </span>
            )}
          </div>
        ))}
      </div>

      {concluido && (
        <p className="list-sub" style={{ marginTop: '0.5rem' }}>
          Tudo que você registrou neste aparelho está no servidor.
        </p>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <Btn variant="ghost" onClick={fechar} disabled={running}>
          {running ? 'Sincronizando…' : 'Fechar'}
        </Btn>
      </div>
    </Modal>
  );
}
