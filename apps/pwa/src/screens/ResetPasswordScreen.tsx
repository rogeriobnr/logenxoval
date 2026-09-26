import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Btn, Field } from '../components/ui';
import { useToast } from '../components/Toasts';
import { ApiError } from '../lib/api';

export function ResetPasswordScreen({ token }: { token: string }) {
  const { api } = useAuth();
  const toast = useToast();
  const [novaSenha, setNovaSenha] = useState('');
  const [novaSenha2, setNovaSenha2] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (novaSenha !== novaSenha2) {
      toast.error('As senhas não conferem.');
      return;
    }
    setBusy(true);
    try {
      await api.request<{ ok: boolean }>('POST', '/auth/reset-password', { token, novaSenha });
      toast.success('Senha redefinida com sucesso. Volte para fazer login.');
      setNovaSenha('');
      setNovaSenha2('');
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED'
          ? 'Link inválido ou expirado. Solicite uma nova recuperação.'
          : err instanceof Error
            ? err.message
            : 'Falha ao redefinir a senha.',
      );
    }
    setBusy(false);
  };

  const voltar = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('recuperar');
    window.history.replaceState({}, '', url.toString());
    window.location.reload();
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">LOGENXOVAL</div>
        <form onSubmit={submit}>
          <Field
            id="rs-nova-senha"
            label="Nova senha (mín. 8 caracteres)"
            type="password"
            autoComplete="new-password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            required
          />
          <Field
            id="rs-nova-senha2"
            label="Confirmar nova senha"
            type="password"
            autoComplete="new-password"
            value={novaSenha2}
            onChange={(e) => setNovaSenha2(e.target.value)}
            required
          />
          <Btn type="submit" disabled={busy}>
            {busy ? 'Redefinindo…' : 'Redefinir senha'}
          </Btn>
        </form>
        <button type="button" className="link-btn" style={{ marginTop: '0.75rem' }} onClick={voltar}>
          Voltar para o login
        </button>
      </div>
    </div>
  );
}