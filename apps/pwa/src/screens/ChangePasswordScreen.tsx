import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { useToast } from '../components/Toasts';
import { navigate } from '../router';

/**
 * Fase 22: tela "Acesso" reúne a troca de senha e a troca de PIN (antes o PIN
 * ficava escondido em Configurações). Também aponta para a recuperação por
 * e-mail quando o usuário não lembra o PIN atual.
 */
export function ChangePasswordScreen() {
  const { changePassword, api } = useAuth();
  const toast = useToast();

  // Senha
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [busy, setBusy] = useState(false);

  // PIN
  const [pinAtual, setPinAtual] = useState('');
  const [novoPin, setNovoPin] = useState('');
  const [novoPin2, setNovoPin2] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // Recuperação do PIN por e-mail
  const [mostrarRecuperarPin, setMostrarRecuperarPin] = useState(false);
  const [emailRec, setEmailRec] = useState('');
  const [recBusy, setRecBusy] = useState(false);

  const submitSenha = async (e: FormEvent) => {
    e.preventDefault();
    if (novaSenha !== confirmar) {
      toast.error('A confirmação não confere com a nova senha.');
      return;
    }
    setBusy(true);
    const res = await changePassword(senhaAtual, novaSenha);
    if (res.ok) {
      toast.success('Senha alterada com sucesso. O acesso offline foi atualizado neste aparelho.');
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmar('');
    } else {
      toast.error(res.message);
    }
    setBusy(false);
  };

  const alterarPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(novoPin)) {
      toast.error('O novo PIN deve ter de 4 a 6 dígitos.');
      return;
    }
    if (novoPin !== novoPin2) {
      toast.error('Os PINs não conferem.');
      return;
    }
    setPinBusy(true);
    try {
      await api.request<{ ok: boolean }>('POST', '/auth/change-pin', { pinAtual, novoPin });
      toast.success('PIN alterado. Ele passa a ser exigido nas confirmações sensíveis.');
      setPinAtual('');
      setNovoPin('');
      setNovoPin2('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao alterar o PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const enviarRecuperacaoPin = async (e: FormEvent) => {
    e.preventDefault();
    setRecBusy(true);
    try {
      await api.request<{ ok: boolean }>('POST', '/auth/forgot-pin', { email: emailRec.trim() });
      toast.success('Se o e-mail estiver cadastrado, enviamos o link para redefinir o PIN. Verifique também o spam.');
      setMostrarRecuperarPin(false);
      setEmailRec('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao solicitar a recuperação do PIN.');
    } finally {
      setRecBusy(false);
    }
  };

  return (
    <div>
      <h2 className="screen-title">Acesso</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <div>
            <div className="list-title">Senha de acesso</div>
            <div className="list-sub">Usada para entrar no app. Ao trocar, o acesso offline é atualizado neste aparelho.</div>
          </div>
        </div>
        <form onSubmit={submitSenha}>
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
        </form>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <div>
            <div className="list-title">PIN de confirmação</div>
            <div className="list-sub">
              Exigido em ações sensíveis (designações, restaurações, desbloqueio de depósito). Se você ainda não tem
              PIN, deixe o campo “PIN atual” vazio.
            </div>
          </div>
        </div>
        <form onSubmit={alterarPin}>
          <Field
            id="pin-atual"
            type="password"
            inputMode="numeric"
            label="PIN atual"
            placeholder="Se ainda não tem PIN, deixe vazio"
            value={pinAtual}
            onChange={(e) => setPinAtual(e.target.value.replace(/\D/g, ''))}
          />
          <Field
            id="pin-novo"
            type="password"
            inputMode="numeric"
            maxLength={6}
            label="Novo PIN (4 a 6 dígitos)"
            placeholder="••••"
            value={novoPin}
            onChange={(e) => setNovoPin(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Field
            id="pin-novo2"
            type="password"
            inputMode="numeric"
            maxLength={6}
            label="Confirmar novo PIN"
            placeholder="••••"
            value={novoPin2}
            onChange={(e) => setNovoPin2(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Btn type="submit" disabled={pinBusy}>
            {pinBusy ? 'Salvando…' : 'Alterar meu PIN'}
          </Btn>
        </form>
        <div style={{ marginTop: '0.6rem' }}>
          {!mostrarRecuperarPin ? (
            <button type="button" className="link-btn" onClick={() => setMostrarRecuperarPin(true)}>
              Esqueci meu PIN
            </button>
          ) : (
            <form onSubmit={enviarRecuperacaoPin} style={{ marginTop: '0.4rem' }}>
              <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
                Enviamos um link para redefinir o PIN (válido por 30 minutos). O link abre na tela de login.
              </div>
              <Field
                id="pin-rec-email"
                type="email"
                label="E-mail cadastrado"
                placeholder="maria@empresa.com"
                value={emailRec}
                onChange={(e) => setEmailRec(e.target.value)}
                required
              />
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <Btn type="submit" variant="secondary" disabled={recBusy}>
                  {recBusy ? 'Enviando…' : 'Enviar link'}
                </Btn>
                <Btn type="button" variant="ghost" onClick={() => setMostrarRecuperarPin(false)} disabled={recBusy}>
                  Cancelar
                </Btn>
              </div>
            </form>
          )}
        </div>
      </div>

      <Alert kind="info">
        O PIN é diferente da senha: a senha entra no app, o PIN confirma ações sensíveis. Se você não tem e-mail
        cadastrado, peça a um administrador para redefinir o seu PIN.
      </Alert>

      <Btn variant="ghost" style={{ marginTop: '0.5rem' }} onClick={() => navigate('/')}>
        Voltar
      </Btn>
    </div>
  );
}
