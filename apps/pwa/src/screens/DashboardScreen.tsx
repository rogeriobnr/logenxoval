import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn } from '../components/ui';
import { navigate } from '../router';

const MENU: Array<{ label: string; route: string }> = [
  { label: 'Enxoval', route: '/enxoval' },
  { label: 'Goldbox', route: '/goldbox' },
  { label: 'Peças Avulsas', route: '/pecas' },
  { label: 'Conferências', route: '/conferencias' },
  { label: 'Consumíveis', route: '/consumiveis' },
  { label: 'EPIs', route: '/epis' },
  { label: 'Solicitações', route: '/solicitacoes' },
  { label: 'Logs', route: '/logs' },
  { label: 'Configurações', route: '/configuracoes' },
];

export function DashboardScreen() {
  const { session, online, api } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  if (!session) return null;

  const sincronizar = async () => {
    setSyncing(true);
    setSyncMsg(null);
    if (!online) {
      setSyncMsg('Sem conexão — operações ficam pendentes no dispositivo.');
      setSyncing(false);
      return;
    }
    try {
      await api.request<unknown>('GET', '/health');
      setSyncMsg('Sincronização completa. (Baixas, conferências e fila chegam nas fases 04–05.)');
    } catch {
      setSyncMsg('Erro de sincronização — verifique a conexão.');
    }
    setSyncing(false);
  };

  const semDeposito = session.depositos.length === 0;

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <div>
            <div className="list-title">
              {session.depositoAtivo ? `Depósito ${session.depositoAtivo.numero}` : 'Sem depósito autorizado'}
            </div>
            <div className="list-sub">
              {session.depositoAtivo ? session.depositoAtivo.nome : 'Peça ao líder para conceder um depósito'}
            </div>
          </div>
          {session.depositos.length > 1 && (
            <Btn variant="secondary" className="small" onClick={() => navigate('/depositos')}>
              Trocar
            </Btn>
          )}
        </div>
      </div>

      {semDeposito && <Alert kind="warn">Nenhum depósito autorizado para sua matrícula.</Alert>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <span className="list-title">Pendências na fila</span>
          <span>0</span>
        </div>
        <div className="list-item">
          <span className="list-title">Divergências abertas</span>
          <span>0</span>
        </div>
        <div className="list-item">
          <span className="list-title">Saldo negativo</span>
          <span>0</span>
        </div>
        <div className="list-item">
          <span className="list-title">Reposições pendentes</span>
          <span>0</span>
        </div>
        <div className="list-item">
          <span className="list-title">Sugestões de conversão</span>
          <span>0</span>
        </div>
      </div>

      {syncMsg && <Alert kind={syncMsg.startsWith('Erro') ? 'error' : 'info'}>{syncMsg}</Alert>}

      <Btn onClick={sincronizar} disabled={syncing} style={{ marginBottom: '1rem' }}>
        {syncing ? 'Sincronizando…' : '⟳ Sincronizar agora'}
      </Btn>

      <div className="grid">
        {MENU.map((m) => (
          <Btn key={m.route} className="secondary" onClick={() => navigate(m.route)}>
            {m.label}
          </Btn>
        ))}
      </div>
    </div>
  );
}