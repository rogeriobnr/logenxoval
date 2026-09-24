import { useEffect } from 'react';
import { useAuth } from './auth/AuthContext';
import { useHashRoute, navigate } from './router';
import { espelharDepositos } from './services/sync';
import { Header } from './components/Header';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { UsersScreen } from './screens/UsersScreen';
import { DepositsScreen } from './screens/DepositsScreen';
import { EnxovalScreen } from './screens/EnxovalScreen';
import { GoldboxScreen } from './screens/GoldboxScreen';
import { ConferenciaScreen } from './screens/ConferenciaScreen';
import { PecasScreen } from './screens/PecasScreen';
import { LogsScreen } from './screens/LogsScreen';
import { OcrReviewScreen } from './screens/OcrReviewScreen';
import { EstoqueScreen, type TabEstoque } from './screens/EstoqueScreen';
import { ChangePasswordScreen } from './screens/ChangePasswordScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { Alert } from './components/ui';

const PLACEHOLDER: Record<string, string> = {
  '/configuracoes': 'Configurações',
};

const ABA_ESTOQUE: Partial<Record<string, TabEstoque>> = {
  '/consumiveis': 'consumiveis',
  '/epis': 'epis',
  '/solicitacoes': 'solicitacoes',
};

export function App() {
  const { status, session, logout, touchActivity, online, api, deviceId } = useAuth();
  const route = useHashRoute();

  // Auto-espelho silencioso: ao abrir o app, ao voltar (focus) e ao voltar a haver rede (docs 7.1).
  useEffect(() => {
    if (status !== 'auth' || !online) return;
    let lastRun = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastRun < 15_000) return;
      lastRun = now;
      void espelharDepositos({ api, deviceId }).catch(() => undefined);
    };
    run();
    const onFocus = () => {
      if (navigator.onLine) run();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status, online, api, deviceId]);

  // Atualiza lastActivityAt a cada interação (docs 3.5).
  useEffect(() => {
    let last = 0;
    const on = () => {
      const now = Date.now();
      if (now - last > 5000) {
        last = now;
        touchActivity();
      }
    };
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [touchActivity]);

  useEffect(() => {
    if (route === '/sair') {
      void logout().then(() => navigate('/login'));
    }
  }, [route, logout]);

  if (status === 'loading') {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo">LOGENXOVAL</div>
          <p className="muted" style={{ textAlign: 'center' }}>
            Carregando…
          </p>
        </div>
      </div>
    );
  }

  if (status === 'anon') return <LoginScreen />;

  const isAdmin = session && session.perfil !== 'MECANICO';

  let content;
  if (route === '/usuarios') {
    content = isAdmin ? <UsersScreen /> : (
      <Alert kind="warn">Seu perfil não permite gerenciar usuários.</Alert>
    );
  } else if (route === '/depositos') {
    content = isAdmin ? <DepositsScreen /> : (
      <Alert kind="warn">Seu perfil não permite gerenciar depósitos.</Alert>
    );
  } else if (route === '/enxoval') {
    content = <EnxovalScreen />;
  } else if (route === '/goldbox') {
    content = <GoldboxScreen />;
  } else if (route === '/conferencias') {
    content = <ConferenciaScreen />;
  } else if (route === '/pecas') {
    content = <PecasScreen />;
  } else if (route === '/logs') {
    content = <LogsScreen />;
  } else if (route === '/revisao-ocr') {
    content = <OcrReviewScreen />;
  } else if (ABA_ESTOQUE[route]) {
    content = <EstoqueScreen inicial={ABA_ESTOQUE[route]} />;
  } else if (route === '/senha') {
    content = <ChangePasswordScreen />;
  } else if (PLACEHOLDER[route]) {
    content = <PlaceholderScreen item={PLACEHOLDER[route]} />;
  } else {
    content = <DashboardScreen />;
  }

  return (
    <div className="app">
      <Header />
      <main className="content">{content}</main>
    </div>
  );
}