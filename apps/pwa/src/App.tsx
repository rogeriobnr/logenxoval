import { useEffect } from 'react';
import { useAuth } from './auth/AuthContext';
import { useHashRoute, navigate } from './router';
import { Header } from './components/Header';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { UsersScreen } from './screens/UsersScreen';
import { DepositsScreen } from './screens/DepositsScreen';
import { ChangePasswordScreen } from './screens/ChangePasswordScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { Alert } from './components/ui';

const PLACEHOLDER: Record<string, string> = {
  '/enxoval': 'Enxoval',
  '/goldbox': 'Goldbox',
  '/pecas': 'Peças Avulsas',
  '/conferencias': 'Conferências',
  '/consumiveis': 'Consumíveis',
  '/epis': 'EPIs',
  '/solicitacoes': 'Solicitações',
  '/logs': 'Logs',
  '/configuracoes': 'Configurações',
};

export function App() {
  const { status, session, logout, touchActivity } = useAuth();
  const route = useHashRoute();

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