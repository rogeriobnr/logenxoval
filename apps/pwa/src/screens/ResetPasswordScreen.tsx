import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Btn, Field } from '../components/ui';
import { useToast } from '../components/Toasts';
import { ApiError } from '../lib/api';

export type ModoRecuperacao = 'senha' | 'pin';

/**
 * Fase 22: mesma tela atende o link de recuperação de senha (`?recuperar=`) e o
 * de PIN (`?recuperar-pin=`), mantendo o usuário dentro do fluxo de e-mail.
 */
export function ResetPasswordScreen({ token, modo = 'senha' }: { token: string; modo?: ModoRecuperacao }) {
  const { api } = useAuth();
  const toast = useToast();
  const [valor, setValor] = useState('');
  const [valor2, setValor2] = useState('');
  const [busy, setBusy] = useState(false);

  const ehPin = modo === 'pin';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (valor !== valor2) {
      toast.error(ehPin ? 'Os PINs não conferem.' : 'As senhas não conferem.');
      return;
    }
    setBusy(true);
    try {
      if (ehPin) {
        await api.request<{ ok: boolean }>('POST', '/auth/reset-pin', { token, novoPin: valor });
        toast.success('PIN redefinido com sucesso. Volte para entrar.');
      } else {
        await api.request<{ ok: boolean }>('POST', '/auth/reset-password', { token, novaSenha: valor });
        toast.success('Senha redefinida com sucesso. Volte para fazer login.');
      }
      setValor('');
      setValor2('');
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED'
          ? 'Link inválido ou expirado. Solicite uma nova recuperação.'
          : err instanceof Error
            ? err.message
            : ehPin
              ? 'Falha ao redefinir o PIN.'
              : 'Falha ao redefinir a senha.',
      );
    }
    setBusy(false);
  };

  const voltar = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete(ehPin ? 'recuperar-pin' : 'recuperar');
    window.history.replaceState({}, '', url.toString());
    window.location.reload();
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">LOGENXOVAL</div>
        <p className="muted" style={{ textAlign: 'center', marginBottom: '1rem' }}>
          {ehPin
            ? 'Defina um novo PIN de confirmação (4 a 6 dígitos).'
            : 'Defina uma nova senha de acesso (mín. 8 caracteres).'}
        </p>
        <form onSubmit={submit}>
          {ehPin ? (
            <>
              <Field
                id="rp-novo-pin"
                label="Novo PIN (4 a 6 dígitos)"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={valor}
                onChange={(e) => setValor(e.target.value.replace(/\D/g, ''))}
                required
              />
              <Field
                id="rp-novo-pin2"
                label="Confirmar novo PIN"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={valor2}
                onChange={(e) => setValor2(e.target.value.replace(/\D/g, ''))}
                required
              />
            </>
          ) : (
            <>
              <Field
                id="rs-nova-senha"
                label="Nova senha (mín. 8 caracteres)"
                type="password"
                autoComplete="new-password"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
              />
              <Field
                id="rs-nova-senha2"
                label="Confirmar nova senha"
                type="password"
                autoComplete="new-password"
                value={valor2}
                onChange={(e) => setValor2(e.target.value)}
                required
              />
            </>
          )}
          <Btn type="submit" disabled={busy}>
            {busy ? 'Redefinindo…' : ehPin ? 'Redefinir PIN' : 'Redefinir senha'}
          </Btn>
        </form>
        <button type="button" className="link-btn" style={{ marginTop: '0.75rem' }} onClick={voltar}>
          Voltar para o login
        </button>
      </div>
    </div>
  );
}
