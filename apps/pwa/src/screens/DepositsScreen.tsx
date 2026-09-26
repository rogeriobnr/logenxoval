import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DepositoRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { listDepositosLocal, upsertDepositos } from '../repos/local';

export function DepositsScreen() {
  const { api, session, changeDeposito } = useAuth();
  const toast = useToast();
  const [deps, setDeps] = useState<DepositoRow[]>([]);
  const [loadInfo, setLoadInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [desativando, setDesativando] = useState<{ id: string; numero: string; nome: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');

  const matricula = session?.matricula ?? '';

  const carregar = useCallback(async () => {
    if (!navigator.onLine) {
      const locais = await listDepositosLocal();
      setDeps(locais);
      setLoadInfo('Modo offline — exibindo espelho local.');
      return;
    }
    try {
      const res = await api.request<{ depositos: DepositoRow[] }>('GET', '/deposits');
      setDeps(res.depositos);
      await upsertDepositos(res.depositos);
      setLoadInfo(null);
    } catch (err) {
      const locais = await listDepositosLocal();
      setDeps(locais);
      setLoadInfo(err instanceof Error ? `Falha na rede — exibindo espelho local. ${err.message}` : 'Não foi possível carregar os depósitos.');
    }
  }, [api]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.request<{ deposito: DepositoRow }>('POST', '/deposits', {
        numero: numero.trim(),
        nome: nome.trim(),
        matriculaConfirmacao: matricula,
      });
      setNumero('');
      setNome('');
      toast.success('Depósito criado com sucesso.');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar depósito.');
    }
    setBusy(false);
  };

  const renomear = async (id: string) => {
    try {
      await api.request<{ deposito: DepositoRow }>('PATCH', `/deposits/${id}`, {
        nome: editNome.trim(),
        matriculaConfirmacao: matricula,
        pin: pin.trim() || undefined,
      });
      setEditId(null);
      setPin('');
      toast.success('Nome do depósito atualizado.');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao renomear.');
    }
  };

  const desativar = async () => {
    if (!desativando) return;
    try {
      await api.request<{ deposito: DepositoRow }>('POST', `/deposits/${desativando.id}/deactivate`, {
        matriculaConfirmacao: matricula,
        pin: pin.trim() || undefined,
        motivo: motivo.trim(),
      });
      setDesativando(null);
      setMotivo('');
      setPin('');
      toast.success('Depósito desativado.');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao desativar.');
    }
  };

  return (
    <div>
      <h2 className="screen-title">Depósitos</h2>

      {loadInfo && <Alert kind="warn">{loadInfo}</Alert>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Novo depósito</h3>
        <form onSubmit={criar}>
          <Field
            id="d-numero"
            label="Número (4 dígitos)"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            required
          />
          <Field id="d-nome" label="Nome / identificação" value={nome} onChange={(e) => setNome(e.target.value)} required />
          <Btn type="submit" disabled={busy}>
            {busy ? 'Criando…' : 'Criar depósito'}
          </Btn>
        </form>
      </div>

      <div className="card">
        <h3>Cadastrados ({deps.length})</h3>
        {deps.map((d) => (
          <div key={d.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="list-title">
                {d.numero} · {d.nome}
              </div>
              <div className="list-sub">
                {d.status === 'ATIVO' ? 'ativo' : 'inativo'}
                {d.versaoAtualEnxoval ? ` · enxoval v${d.versaoAtualEnxoval}` : ''}
              </div>

              {editId === d.id && (
                <div style={{ marginTop: '0.5rem' }}>
                  <Field id="edit-nome" label="Novo nome" value={editNome} onChange={(e) => setEditNome(e.target.value)} />
                  {d.status === 'ATIVO' && (
                    <Field
                      id="edit-pin"
                      label="PIN administrativo (se configurado)"
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                    />
                  )}
                  <Btn className="small" onClick={() => void renomear(d.id)}>
                    Salvar nome
                  </Btn>
                </div>
              )}

              </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
              <Btn
                variant="secondary"
                className="small"
                onClick={() => {
                  setEditId(editId === d.id ? null : d.id);
                  setEditNome(d.nome);
                }}
              >
                {editId === d.id ? 'Fechar' : 'Renomear'}
              </Btn>
              {d.status === 'ATIVO' && (
                <Btn
                  variant="danger"
                  className="small"
                  onClick={() => {
                    setDesativando({ id: d.id, numero: d.numero, nome: d.nome });
                    setMotivo('');
                    setPin('');
                    setEditId(null);
                  }}
                >
                  Desativar
                </Btn>
              )}
              {d.status === 'ATIVO' && (
                <Btn variant="ghost" className="small" onClick={() => void changeDeposito(d.id)}>
                  Ativar como atual
                </Btn>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={desativando !== null}
        title="Desativar depósito"
        message={
          desativando
            ? `Desativar o depósito ${desativando.numero} · ${desativando.nome}? O enxoval ficará indisponível para baixas.`
            : undefined
        }
        confirmLabel="Confirmar desativação"
        danger
        busy={busy}
        onConfirm={() => void desativar()}
        onCancel={() => setDesativando(null)}
      >
        <Field
          id="deact-motivo"
          label="Motivo (mín. 5 caracteres)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
        />
        <Field id="deact-pin" type="password" label="PIN administrativo (se configurado)" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
      </ConfirmDialog>
    </div>
  );
}