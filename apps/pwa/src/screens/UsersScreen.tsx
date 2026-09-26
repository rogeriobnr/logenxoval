import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PERFIL, type DepositoRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field, SelectField } from '../components/ui';

interface UserInfo {
  id: string;
  matricula: string;
  nome: string;
  sobrenome: string;
  email?: string | null;
  perfil: string;
  status: string;
  temPin: boolean;
  depositoIds?: string[];
}

export function UsersScreen() {
  const { api, session } = useAuth();
  const isAdmin = session?.perfil === PERFIL.ADMIN;
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [deps, setDeps] = useState<DepositoRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [pin, setPin] = useState('');
  const [perfil, setPerfil] = useState<string>(PERFIL.MECANICO);
  const [formMsg, setFormMsg] = useState<{ kind: 'error' | 'info' | 'warn'; text: string } | null>(null);

  // designação de depósito (admin)
  const [pinDesignacao, setPinDesignacao] = useState('');
  const [matriculaDesignacao, setMatriculaDesignacao] = useState(session?.matricula ?? '');
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  // redefinição de PIN (admin)
  const [novoPinDe, setNovoPinDe] = useState<Record<string, string>>({});
  const [resetPinBusy, setResetPinBusy] = useState<string | null>(null);

  const matriculaLogada = session?.matricula ?? '';

  const carregar = useCallback(async () => {
    if (!navigator.onLine) {
      setLoadError('Offline: não é possível gerenciar usuários sem conexão.');
      return;
    }
    try {
      const res = await api.request<{ usuarios: UserInfo[] }>('GET', '/users');
      setUsers(res.usuarios);
      if (isAdmin) {
        const depRes = await api.request<{ depositos: DepositoRow[] }>('GET', '/deposits');
        setDeps(depRes.depositos);
      }
      setLoadError(null);
    } catch {
      setLoadError('Não foi possível carregar os usuários.');
    }
  }, [api, isAdmin]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormMsg(null);
    try {
      await api.request<{ usuario: UserInfo }>('POST', '/users', {
        nome: nome.trim(),
        sobrenome: sobrenome.trim(),
        matricula: matricula.trim(),
        email: email.trim(),
        senha,
        perfil,
        pin,
      });
      setNome('');
      setSobrenome('');
      setMatricula('');
      setEmail('');
      setSenha('');
      setPin('');
      setFormMsg({ kind: 'info', text: 'Usuário criado com sucesso.' });
      await carregar();
    } catch (err) {
      setFormMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao criar usuário.',
      });
    }
    setBusy(false);
  };

  const atualizar = async (user: UserInfo, patch: { status?: string; perfil?: string }) => {
    try {
      await api.request<{ ok: boolean }>('PATCH', `/users/${user.id}`, patch);
      setFormMsg({ kind: 'info', text: `Usuário ${user.matricula} atualizado.` });
      await carregar();
    } catch (err) {
      setFormMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao atualizar usuário.',
      });
    }
  };

  const redefinirPin = async (user: UserInfo) => {
    const valor = (novoPinDe[user.id] ?? '').trim();
    if (!/^\d{4,6}$/.test(valor)) {
      setFormMsg({ kind: 'warn', text: 'Informe um PIN de 4 a 6 dígitos.' });
      return;
    }
    setResetPinBusy(user.id);
    setFormMsg(null);
    try {
      await api.request<{ ok: boolean }>('PATCH', `/users/${user.id}`, { novoPin: valor });
      setNovoPinDe((m) => ({ ...m, [user.id]: '' }));
      setFormMsg({ kind: 'info', text: `PIN de ${user.matricula} redefinido.` });
      await carregar();
    } catch (err) {
      setFormMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao redefinir o PIN.',
      });
    }
    setResetPinBusy(null);
  };

  const alternarDeposito = async (user: UserInfo, depositoId: string) => {
    const concedido = (user.depositoIds ?? []).includes(depositoId);
    setToggling(`${user.id}:${depositoId}`);
    setFormMsg(null);
    const body = { matriculaConfirmacao: matriculaDesignacao.trim(), pin: pinDesignacao.trim() || undefined };
    try {
      if (concedido) {
        await api.request<{ ok: boolean }>('DELETE', `/users/${user.id}/deposits/${depositoId}`, body);
      } else {
        await api.request<{ ok: boolean }>('POST', `/users/${user.id}/deposits`, {
          ...body,
          depositoId,
        });
      }
      setFormMsg({
        kind: 'info',
        text: concedido
          ? `Acesso do usuário ${user.matricula} ao depósito revogado.`
          : `Depósito designado ao usuário ${user.matricula}.`,
      });
      await carregar();
    } catch (err) {
      setFormMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao designar depósito.',
      });
    }
    setToggling(null);
  };

  const descricaoStatus = (u: UserInfo) =>
    u.status === 'ATIVO' ? 'ativo' : u.status === 'PENDENTE' ? 'aguardando aprovação' : 'bloqueado';

  return (
    <div>
      <h2 className="screen-title">Usuários</h2>

      {loadError && <Alert kind="error">{loadError}</Alert>}
      {formMsg && <Alert kind={formMsg.kind}>{formMsg.text}</Alert>}

      {!isAdmin && (
        <Alert kind="info">
          Como Líder você cria usuarios (MECANICO/LIDER) e vê a lista de não-admins. Aprovação de cadastros,
          bloqueio e designação de depósitos são ações do administrador.
        </Alert>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Novo usuário</h3>
        <form onSubmit={criar}>
          <Field id="u-nome" label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          <Field
            id="u-sobrenome"
            label="Sobrenome"
            value={sobrenome}
            onChange={(e) => setSobrenome(e.target.value)}
            required
          />
          <Field
            id="u-matricula"
            label="Matrícula"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
            required
          />
          <Field
            id="u-email"
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            id="u-senha"
            label="Senha (mín. 8 caracteres)"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          <Field
            id="u-pin"
            label="PIN (4 a 6 dígitos)"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
          />
          <SelectField id="u-perfil" label="Perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            <option value={PERFIL.MECANICO}>Mecânico</option>
            <option value={PERFIL.LIDER}>Líder</option>
            {isAdmin && <option value={PERFIL.ADMIN}>Administrador</option>}
          </SelectField>
          <Btn type="submit" disabled={busy}>
            {busy ? 'Criando…' : 'Criar usuário'}
          </Btn>
        </form>
      </div>

      <div className="card">
        <h3>Cadastrados ({users.length})</h3>

        {isAdmin && deps.length > 0 && (
          <div style={{ marginBottom: '0.5rem' }}>
            <Alert kind="warn">
              Para designar depósitos, confirme com sua matrícula {matriculaLogada} e seu PIN (se definido).
            </Alert>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Field
                id="designa-matricula"
                label="Matrícula de confirmação"
                value={matriculaDesignacao}
                onChange={(e) => setMatriculaDesignacao(e.target.value)}
              />
              <Field
                id="designa-pin"
                label="Seu PIN (se definido)"
                type="password"
                inputMode="numeric"
                value={pinDesignacao}
                onChange={(e) => setPinDesignacao(e.target.value)}
                placeholder="●●●●"
              />
            </div>
          </div>
        )}

        {users.map((u) => {
          const souEu = u.id === session?.userId;
          const temDesignacao = isAdmin && deps.length > 0;
          return (
            <div key={u.id} className="list-item">
              <div style={{ flex: 1 }}>
                <div className="list-title">
                  {u.nome} {u.sobrenome} · {u.matricula}
                </div>
                <div className="list-sub">
                  {u.perfil} · {descricaoStatus(u)} {u.temPin ? '' : ' · SEM PIN definido'}
                  {(u.depositoIds?.length ?? 0) > 0
                    ? ` · ${u.depositoIds!.length} depósito(s) designado(s)`
                    : ''}
                </div>

                {temDesignacao && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <Btn
                      variant="ghost"
                      className="small"
                      disabled={toggling !== null}
                      onClick={() => setExpandido(expandido === u.id ? null : u.id)}
                    >
                      {expandido === u.id ? 'Fechar designação' : 'Designar depósitos'}
                    </Btn>

                    {expandido === u.id && (
                      <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {deps.map((d) => {
                          const marcado = (u.depositoIds ?? []).includes(d.id);
                          const ocupado = toggling === `${u.id}:${d.id}`;
                          return (
                            <label
                              key={d.id}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                disabled={toggling !== null}
                                onChange={() => void alternarDeposito(u, d.id)}
                              />
                              <span>
                                {d.numero} · {d.nome}
                              </span>
                              {ocupado && <span className="list-sub">salvando…</span>}
                            </label>
                          );
                        })}
                        {deps.length === 0 && <span className="list-sub">Nenhum depósito ativo.</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!souEu && isAdmin && (
                <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <Btn
                    variant={u.status === 'ATIVO' ? 'danger' : 'secondary'}
                    className="small"
                    onClick={() => atualizar(u, { status: u.status === 'ATIVO' ? 'BLOQUEADO' : 'ATIVO' })}
                  >
                    {u.status === 'ATIVO' ? 'Bloquear' : 'Ativar'}
                  </Btn>
                  <select value={u.perfil} onChange={(e) => atualizar(u, { perfil: e.target.value })}>
                    <option value={PERFIL.MECANICO}>Mecânico</option>
                    <option value={PERFIL.LIDER}>Líder</option>
                    <option value={PERFIL.ADMIN}>Administrador</option>
                  </select>
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="PIN 4-6"
                      value={novoPinDe[u.id] ?? ''}
                      onChange={(e) => setNovoPinDe((m) => ({ ...m, [u.id]: e.target.value.replace(/\D/g, '') }))}
                      style={{ width: '5.5rem', minHeight: '32px', padding: '0.25rem 0.5rem' }}
                    />
                    <Btn
                      variant="ghost"
                      className="small"
                      disabled={resetPinBusy !== null}
                      onClick={() => void redefinirPin(u)}
                    >
                      {resetPinBusy === u.id ? '…' : 'Redefinir PIN'}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}