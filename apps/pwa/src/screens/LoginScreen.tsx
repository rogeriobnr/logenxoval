import { useState, type FormEvent } from 'react';
import { PERFIL } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field, SelectField } from '../components/ui';
import { ApiError } from '../lib/api';

type Aba = 'entrar' | 'cadastro' | 'recuperar';

export function LoginScreen() {
  const { login, online, api } = useAuth();
  const [aba, setAba] = useState<Aba>('entrar');
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // cadastro
  const [cNome, setCNome] = useState('');
  const [cSobrenome, setCSobrenome] = useState('');
  const [cMatricula, setCMatricula] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cSenha, setCSenha] = useState('');
  const [cSenha2, setCSenha2] = useState('');
  const [cPin, setCPin] = useState('');
  const [cPin2, setCPin2] = useState('');
  const [cPerfil, setCPerfil] = useState<string>(PERFIL.MECANICO);
  const [cadMsg, setCadMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [cadBusy, setCadBusy] = useState(false);

  // recuperação
  const [rEmail, setREmail] = useState('');
  const [recMsg, setRecMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(matricula, senha);
    if (!res.ok) setError({ code: res.code, message: res.message });
    setBusy(false);
  };

  const cadastrar = async (e: FormEvent) => {
    e.preventDefault();
    setCadMsg(null);
    if (cSenha !== cSenha2) {
      setCadMsg({ kind: 'error', text: 'As senhas não conferem.' });
      return;
    }
    if (cPin !== cPin2) {
      setCadMsg({ kind: 'error', text: 'Os PINs não conferem.' });
      return;
    }
    setCadBusy(true);
    try {
      await api.request<{ usuario: { matricula: string; status: string } }>('POST', '/auth/register', {
        nome: cNome.trim(),
        sobrenome: cSobrenome.trim(),
        matricula: cMatricula.trim(),
        email: cEmail.trim(),
        senha: cSenha,
        perfil: cPerfil,
        pin: cPin,
      });
      setCadMsg({
        kind: 'info',
        text: `Cadastro enviado para ${cMatricula.trim()}! Um administrador precisa aprovar antes do primeiro login.`,
      });
      setMatricula(cMatricula.trim());
      setCNome('');
      setCSobrenome('');
      setCMatricula('');
      setCEmail('');
      setCSenha('');
      setCSenha2('');
      setCPin('');
      setCPin2('');
      setAba('entrar');
    } catch (err) {
      setCadMsg({
        kind: 'error',
        text:
          err instanceof ApiError && err.code === 'CONFLITO'
            ? 'Matrícula ou e-mail já cadastrados. Entre em contato com o administrador.'
            : err instanceof Error
              ? err.message
              : 'Falha ao enviar o cadastro.',
      });
    }
    setCadBusy(false);
  };

  const recuperar = async (e: FormEvent) => {
    e.preventDefault();
    setRecBusy(true);
    setRecMsg(null);
    try {
      await api.request<{ ok: boolean }>('POST', '/auth/forgot-password', { email: rEmail.trim() });
      setRecMsg({
        kind: 'info',
        text: 'Se o e-mail estiver cadastrado, enviamos o link de recuperação. Verifique sua caixa de entrada (e o spam).',
      });
    } catch (err) {
      setRecMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao solicitar recuperação.',
      });
    }
    setRecBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">LOGENXOVAL</div>

        <div className="chip" style={{ margin: '0 auto 1rem', display: 'flex', width: 'fit-content' }}>
          <i className={`status-dot ${online ? 'status-online' : 'status-offline'}`} />
          {online ? 'online' : 'offline'}
        </div>

        <div className="tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', justifyContent: 'center' }}>
          <Btn variant={aba === 'entrar' ? 'primary' : 'ghost'} className="small" onClick={() => { setAba('entrar'); setError(null); setRecMsg(null); }}>
            Entrar
          </Btn>
          <Btn variant={aba === 'cadastro' ? 'primary' : 'ghost'} className="small" onClick={() => { setAba('cadastro'); setError(null); setRecMsg(null); }}>
            Criar conta
          </Btn>
        </div>

        {!online && (
          <Alert kind="warn">
            Sem conexão você só consegue entrar com usuário que já autenticou neste aparelho. Cadastro e recuperação
            exigem conexão.
          </Alert>
        )}

        {aba === 'entrar' && (
          <>
            {error && <Alert kind="error">{error.message}</Alert>}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
              <button type="button" className="link-btn" onClick={() => setAba('recuperar')}>
                Esqueci minha senha
              </button>
              <span className="muted">Autenticação offline limitada a este aparelho.</span>
            </div>
          </>
        )}

        {aba === 'cadastro' && (
          <>
            {cadMsg && <Alert kind={cadMsg.kind}>{cadMsg.text}</Alert>}
            <Alert kind="info">
              Crie sua conta (LÍDER ou MECÂNICO). O cadastro fica aguardando aprovação de um administrador antes do
              primeiro login.
            </Alert>
            <form onSubmit={cadastrar}>
              <Field id="c-nome" label="Nome" value={cNome} onChange={(e) => setCNome(e.target.value)} required placeholder="Maria" />
              <Field id="c-sobrenome" label="Sobrenome" value={cSobrenome} onChange={(e) => setCSobrenome(e.target.value)} required placeholder="Silva" />
              <Field id="c-matricula" label="Matrícula" value={cMatricula} onChange={(e) => setCMatricula(e.target.value)} required placeholder="000123" />
              <Field id="c-email" label="E-mail" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} required placeholder="maria@empresa.com" />
              <SelectField id="c-perfil" label="Perfil" value={cPerfil} onChange={(e) => setCPerfil(e.target.value)}>
                <option value={PERFIL.MECANICO}>Mecânico</option>
                <option value={PERFIL.LIDER}>Líder</option>
              </SelectField>
              <Field
                id="c-senha"
                label="Senha (mín. 8 caracteres)"
                type="password"
                autoComplete="new-password"
                value={cSenha}
                onChange={(e) => setCSenha(e.target.value)}
                required
              />
              <Field
                id="c-senha2"
                label="Confirmar senha"
                type="password"
                autoComplete="new-password"
                value={cSenha2}
                onChange={(e) => setCSenha2(e.target.value)}
                required
              />
              <Field
                id="c-pin"
                label="PIN (4 a 6 dígitos)"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={cPin}
                onChange={(e) => setCPin(e.target.value.replace(/\D/g, ''))}
                required
              />
              <Field
                id="c-pin2"
                label="Confirmar PIN"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={cPin2}
                onChange={(e) => setCPin2(e.target.value.replace(/\D/g, ''))}
                required
              />
              <Btn type="submit" disabled={cadBusy || !online}>
                {cadBusy ? 'Enviando…' : 'Criar conta'}
              </Btn>
            </form>
          </>
        )}

        {aba === 'recuperar' && (
          <>
            {recMsg && <Alert kind={recMsg.kind}>{recMsg.text}</Alert>}
            <Alert kind="info">
              Informe o e-mail cadastrado na sua conta. Enviamos um link de redefinição válido por 30 minutos.
            </Alert>
            <form onSubmit={recuperar}>
              <Field id="r-email" label="E-mail" type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} required placeholder="maria@empresa.com" />
              <Btn type="submit" disabled={recBusy || !online}>
                {recBusy ? 'Enviando…' : 'Enviar link de recuperação'}
              </Btn>
            </form>
            <button
              type="button"
              className="link-btn"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setAba('entrar')}
            >
              Voltar para o login
            </button>
          </>
        )}
      </div>
    </div>
  );
}