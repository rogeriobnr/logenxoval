import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { espelharDepositos } from '../services/sync';
import { Btn } from './ui';
import { Modal } from './Modal';
import { useToast } from './Toasts';

interface StepLine {
  message: string;
  ok?: boolean;
}

export function SyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, deviceId, online } = useAuth();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepLine[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    const run = async () => {
      setRunning(true);
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
          const extras = [res.enviadas ? `${res.enviadas} baixa(s) enviada(s)` : null, res.errosFila ? `${res.errosFila} erro(s) na fila` : null]
            .filter(Boolean)
            .join(' · ');
          setSteps((prev) => [
            ...prev,
            { message: `Espelho atualizado (${res.sincronizados} depósito(s)).${extras ? ` ${extras}.` : ''}`, ok: true },
          ]);
        }
      } catch (err) {
        if (!cancel) {
          toast.error(err instanceof Error ? err.message : 'Erro de sincronização.');
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
  }, [open, api, deviceId, online, toast]);

  const fechar = () => {
    if (running) return;
    onClose();
  };

  return (
    <Modal open={open} title="Sincronizar agora" onClose={fechar}>
      {steps.map((s, i) => (
        <div key={i} className="list-item" style={{ borderBottom: 'none' }}>
          <span>{s.message}</span>
          {s.ok && <span style={{ color: 'var(--ok)' }}>ok</span>}
        </div>
      ))}
      {running && <div className="muted">…</div>}
      {steps.length === 0 && running && <div className="muted">Iniciando…</div>}
      <div style={{ marginTop: '1rem' }}>
        <Btn variant="ghost" onClick={fechar} disabled={running}>
          Fechar
        </Btn>
      </div>
    </Modal>
  );
}