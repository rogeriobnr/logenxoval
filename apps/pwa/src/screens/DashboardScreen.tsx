import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn } from '../components/ui';
import { SyncModal } from '../components/SyncModal';
import { statusSync } from '../lib/status';
import { onSync } from '../lib/events';
import { getPendenciasLocais, getSyncState } from '../repos/local';
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
  { label: 'Relatórios', route: '/relatorios' },
  { label: 'Configurações', route: '/configuracoes' },
];

const STATUS_LABEL: Record<string, string> = {
  SINCRONIZADO: 'Sincronizado',
  OFFLINE_SEM_PENDENCIA: 'Offline sem pendências',
  OFFLINE_COM_PENDENCIA: 'Offline com pendências',
  SINCRONIZANDO: 'Sincronizando',
  ERRO_SINCRONIZACAO: 'Erro de sincronização',
  CONFLITO_PENDENTE: 'Conflito pendente',
};

function tempoRelativo(iso: string | null): string {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export function DashboardScreen() {
  const { session, online, deviceId } = useAuth();
  const [pendencias, setPendencias] = useState({ fila: 0, divergencias: 0, negativos: 0, errosFila: 0, sugestoesPendentes: 0 });
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [erroSync, setErroSync] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const recarregar = useCallback(async () => {
    const depositoId = session?.depositoAtivo?.id;
    setPendencias(await getPendenciasLocais(depositoId));
    if (depositoId) {
      const st = await getSyncState(deviceId, depositoId);
      setUltimaSync(st?.lastSyncAt ?? null);
    }
  }, [session?.depositoAtivo?.id, deviceId]);

  useEffect(() => {
    void recarregar();
    const unsub = onSync(() => void recarregar());
    return unsub;
  }, [recarregar]);

  if (!session) return null;

  const est = statusSync({
    online,
    filaPendente: pendencias.fila,
    erro: (erroSync || pendencias.errosFila > 0) && online,
    sincronizando: false,
    conflitoPendente: false,
  });

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
            <div className="list-sub">
              {STATUS_LABEL[est]} · última sync {tempoRelativo(ultimaSync)}
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
          <span>{pendencias.fila}</span>
        </div>
        <div className="list-item">
          <span className="list-title">Divergências abertas</span>
          <span>{pendencias.divergencias}</span>
        </div>
        <div className="list-item">
          <span className="list-title">Saldo negativo</span>
          <span>{pendencias.negativos}</span>
        </div>
        <div className="list-item">
          <span className="list-title">Sugestões de conversão pendentes</span>
          <span>{pendencias.sugestoesPendentes}</span>
        </div>
        {pendencias.errosFila > 0 && (
          <div className="list-item">
            <span className="list-title">Erros na fila de sincronização</span>
            <span className="list-title warn">{pendencias.errosFila}</span>
          </div>
        )}
      </div>

      <Btn onClick={() => setModalOpen(true)} style={{ marginBottom: '1rem' }}>
        {online ? '⟳ Sincronizar agora' : 'Sem conexão — operações ficam pendentes'}
      </Btn>

      <div className="grid">
        {MENU.map((m) => (
          <Btn key={m.route} className="secondary" onClick={() => navigate(m.route)}>
            {m.label}
          </Btn>
        ))}
      </div>

      <SyncModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setErroSync(false);
          void recarregar();
        }}
      />
    </div>
  );
}