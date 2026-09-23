import { Alert, Btn } from '../components/ui';
import { navigate } from '../router';

const FASE_POR_ITEM: Record<string, string> = {
  Enxoval: 'fase 03',
  Goldbox: 'fase 04',
  'Peças Avulsas': 'fase 07',
  'Conferências': 'fase 06',
  'Consumíveis': 'fase 10',
  'EPIs': 'fase 10',
  'Solicitações': 'fase 10',
  'Logs': 'fase 08',
  'Configurações': 'fase 12',
};

export function PlaceholderScreen({ item }: { item: string }) {
  return (
    <div className="card">
      <h2 className="screen-title">{item}</h2>
      <Alert kind="info">
        Esta tela será implementada na {FASE_POR_ITEM[item] ?? 'próxima fase'} do roadmap. Operações críticas seguem a
        regra de ouro: depósito + usuário + data/hora + quantidade + auditoria.
      </Alert>
      <Btn variant="ghost" onClick={() => navigate('/')}>
        Voltar
      </Btn>
    </div>
  );
}