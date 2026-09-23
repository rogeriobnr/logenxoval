import { useAuth } from '../auth/AuthContext';
import { navigate } from '../router';

export function Header() {
  const { session, online, status } = useAuth();

  if (!session) return null;

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-user">
          <span className="header-name">{session.nomeCompleto}</span>
          <div className="header-meta">
            <span>{session.matricula}</span>
            <span>·</span>
            <span className="chip">
              <i className={`status-dot ${online ? 'status-online' : 'status-offline'}`} />
              {session.depositoAtivo
                ? `Dep ${session.depositoAtivo.numero}`
                : status === 'auth'
                  ? 'Sem depósito'
                  : ''}
            </span>
          </div>
        </div>
        <div className="header-actions">
          {session.perfil !== 'MECANICO' && (
            <button className="chip" onClick={() => navigate(session.depositos.length > 1 ? '/depositos' : '/usuarios')}>
              Trocar
            </button>
          )}
        </div>
      </div>
      <nav className="nav">
        <a href="#/" className={window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#/dashboard' ? 'active' : ''}>
          Início
        </a>
        {session.perfil !== 'MECANICO' && (
          <>
            <a href="#/usuarios" className={window.location.hash === '#/usuarios' ? 'active' : ''}>
              Usuários
            </a>
            <a href="#/depositos" className={window.location.hash === '#/depositos' ? 'active' : ''}>
              Depósitos
            </a>
          </>
        )}
        <a href="#/senha" className={window.location.hash === '#/senha' ? 'active' : ''}>
          Senha
        </a>
        <a href="#/sair" className={window.location.hash === '#/sair' ? 'active' : ''}>
          Sair
        </a>
      </nav>
    </header>
  );
}