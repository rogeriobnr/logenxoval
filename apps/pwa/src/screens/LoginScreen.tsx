import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';

export function LoginScreen() {
  const { login, online } = useAuth();
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(matricula, senha);
    if (!res.ok) setError({ code: res.code, message: res.message });
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">LOGENXOVAL</div>

        <div className="chip" style={{ margin: '0 auto 1rem', display: 'flex', width: 'fit-content' }}>
          <i className={`status-dot ${online ? 'status-online' : 'status-offline'}`} />
          {online ? 'online' : 'offline'}
        </div>

        {error && <Alert kind="error">{error.message}</Alert>}

        <Alert kind="warn">
          Autenticação offline é limitada a este dispositivo. A confirmação definitiva ocorre na sincronização com o
          servidor.
        </Alert>

        <form onSubmit={submit}>
          <Field
            id="matricula"
            label="Matrícula"
            placeholder="000123"
            autoComplete="username"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
            required
          />
          <Field
            id="senha"
            label="Senha"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          <Btn type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Btn>
        </form>
      </div>
    </div>
  );
}