import { useState, type FormEvent } from 'react';
import { PERFIL } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field, SelectField } from '../components/ui';
import { ApiError } from '../lib/api';

type Aba = 'entrar' | 'cadastro';

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
  const [cSenha, setCSenha] = useState('');
  const [cSenha2, setCSenha2] = useState('');
  const [cPerfil, setCPerfil] = useState<string>(PERFIL.MECANICO);
  const [cadMsg, setCadMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [cadBusy, setCadBusy] = useState(false);

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
    setCadBusy(true);
    try {
      await api.request<{ usuario: { matricula: string; status: string } }>('POST', '/auth/register', {
        nome: cNome.trim(),
        sobrenome: cSobrenome.trim(),
        matricula: cMatricula.trim(),
        senha: cSenha,
        perfil: cPerfil,
      });
      setCadMsg({
        kind: 'info',
        text: `Cadastro enviado para ${cMatricula.trim()}! Um administrador precisa aprovar antes do primeiro login.`,
      });
      setMatricula(cMatricula.trim());
      setCNome('');
      setCSobrenome('');
      setCMatricula('');
      setCSenha('');
      setCSenha2('');
      setAba('entrar');
    } catch (err) {
      setCadMsg({
        kind: 'error',
        text:
          err instanceof ApiError && err.code === 'CONFLITO'
            ? 'Matrícula já cadastrada. Entre em contato com o administrador.'
            : err instanceof Error
              ? err.message
              : 'Falha ao enviar o cadastro.',
      });
    }
    setCadBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">LOGENXOVAL</div>

        <div className="chip" style={{ margin: '0 auto 1rem', display: 'flex', width: 'fit-content' }}>
          <i className={`status-dot ${online ? 'status-online' : 'status-offline'}`} />
          {online ? 'online' : 'offline'}
        </div>

        <div className="tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <Btn variant={aba === 'entrar' ? 'primary' : 'ghost'} className="small" onClick={() => { setAba('entrar'); setError(null); }}>
            Entrar
          </Btn>
          <Btn variant={aba === 'cadastro' ? 'primary' : 'ghost'} className="small" onClick={() => { setAba('cadastro'); setError(null); }}>
            Criar conta
          </Btn>
        </div>

        {!online && (
          <Alert kind="warn">
            Sem conexão você só consegue entrar com usuário que já autenticou neste aparelho. Cadastro exige conexão.
          </Alert>
        )}

        {aba === 'entrar' && (
          <>
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
              <Btn type="submit" disabled={cadBusy || !online}>
                {cadBusy ? 'Enviando…' : 'Criar conta'}
              </Btn>
            </form>
          </>
        )}
      </div>
    </div>
  );
}