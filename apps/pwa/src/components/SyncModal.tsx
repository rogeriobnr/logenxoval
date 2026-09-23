import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { espelharDepositos } from '../services/sync';
import { Alert, Btn } from './ui';

interface StepLine {
  message: string;
  ok?: boolean;
}

export function SyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, deviceId, online } = useAuth();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepLine[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    const run = async () => {
      setRunning(true);
      setErro(null);
      setSteps([]);
      if (!online) {
        setSteps([{ message: 'Sem conexão — operações mantidas pendentes no dispositivo.' }]);
        setRunning(false);
        return;
      }
      try {
        const res = await espelharDepositos({
          api,
          deviceId,
          report: (message) => {
            if (!cancel) setSteps((prev) => [...prev, { message }]);
          },
        });
        if (!cancel) {
          setSteps((prev) => [...prev, { message: `Espelho atualizado (${res.sincronizados} depósito(s)).`, ok: true }]);
        }
      } catch (err) {
        if (!cancel) {
          setErro(err instanceof Error ? err.message : 'Erro de sincronização.');
          setSteps((prev) => [...prev, { message: 'Falha na sincronização.' }]);
        }
      } finally {
        if (!cancel) setRunning(false);
      }
    };
    void run();
    return () => {
      cancel = true;
    };
  }, [open, api, deviceId, online]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16,22,19,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <h2 className="screen-title">Sincronizar agora</h2>
        {steps.map((s, i) => (
          <div key={i} className="list-item" style={{ borderBottom: 'none' }}>
            <span>{s.message}</span>
            {s.ok && <span style={{ color: 'var(--ok)' }}>ok</span>}
          </div>
        ))}
        {running && <div className="muted">…</div>}
        {erro && <Alert kind="error">{erro}</Alert>}
        <div style={{ marginTop: '1rem' }}>
          <Btn variant="ghost" onClick={onClose} disabled={running}>
            Fechar
          </Btn>
        </div>
      </div>
    </div>
  );
}