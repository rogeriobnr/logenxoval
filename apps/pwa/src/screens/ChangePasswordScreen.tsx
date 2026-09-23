import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { navigate } from '../router';

export function ChangePasswordScreen() {
  const { changePassword } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (novaSenha !== confirmar) {
      setMsg({ kind: 'error', text: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setBusy(true);
    const res = await changePassword(senhaAtual, novaSenha);
    if (res.ok) {
      setMsg({ kind: 'info', text: 'Senha alterada com sucesso. O acesso offline foi atualizado neste aparelho.' });
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmar('');
    } else {
      setMsg({ kind: 'error', text: res.message });
    }
    setBusy(false);
  };

  return (
    <div>
      <h2 className="screen-title">Alterar senha</h2>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="card">
        <form onSubmit={submit}>
          <Field
            id="pw-atual"
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            required
          />
          <Field
            id="pw-nova"
            label="Nova senha (mín. 8 caracteres)"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            required
          />
          <Field
            id="pw-confirmar"
            label="Confirmar nova senha"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            required
          />
          <Btn type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Alterar senha'}
          </Btn>
          <Btn variant="ghost" style={{ marginTop: '0.5rem' }} onClick={() => navigate('/')}>
            Voltar
          </Btn>
        </form>
      </div>
    </div>
  );
}