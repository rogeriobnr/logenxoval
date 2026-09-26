import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { exportarBackupLocal, importarBackupLocal, EXTENSAO_BACKUP } from '../lib/backup';
import { compartilharArquivo, podeCompartilharArquivos, salvarComDialogoOuDownload } from '../lib/exportar';
import { ApiError, isNetworkError } from '../lib/api';
import { listarSnapshots, restaurarSnapshotV12, type SnapshotListado } from '../services/sync';

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(['pt-BR'], { dateStyle: 'short', timeStyle: 'short' });
}

export function ConfiguracoesScreen() {
  const { session, online, api } = useAuth();
  const toast = useToast();
  const depositoId = session?.depositoAtivo?.id;
  const podeRestaurar = !!session && session.perfil !== 'MECANICO';

  // Backup do dispositivo
  const [senhaBackup, setSenhaBackup] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFeito, setBackupFeito] = useState<{ nome: string; metodo: 'salvo' | 'download'; blob: Blob; senha: string } | null>(null);
  const [compartilhando, setCompartilhando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Snapshots do servidor
  const [snapshots, setSnapshots] = useState<SnapshotListado[] | null>(null);
  const [restaurando, setRestaurando] = useState<SnapshotListado | null>(null);
  const [restaurarBusy, setRestaurarBusy] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [matricula, setMatricula] = useState(session?.matricula ?? '');
  const [pin, setPin] = useState('');

  // Meu PIN
  const [pinAtual, setPinAtual] = useState('');
  const [novoPin, setNovoPin] = useState('');
  const [novoPin2, setNovoPin2] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  async function alterarPin() {
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
      await api.request<{ ok: boolean }>('POST', '/auth/change-pin', {
        pinAtual: pinAtual,
        novoPin,
      });
      toast.success('PIN alterado. Ele passa a ser exigido nas confirmações sensíveis.');
      setPinAtual('');
      setNovoPin('');
      setNovoPin2('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao alterar o PIN.');
    } finally {
      setPinBusy(false);
    }
  }

  const carregarSnapshots = useCallback(async () => {
    if (!podeRestaurar || !depositoId || !online) return;
    try {
      setSnapshots(await listarSnapshots(api, depositoId));
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? 'Offline: não foi possível carregar os pontos de restauração.'
          : err instanceof Error
            ? err.message
            : 'Falha ao carregar pontos de restauração.',
      );
      setSnapshots([]);
    }
  }, [api, depositoId, podeRestaurar, online, toast]);

  useEffect(() => {
    void carregarSnapshots();
  }, [carregarSnapshots]);

  async function exportar() {
    setBackupFeito(null);
    if (!senhaBackup) {
      toast.error('Informe uma senha para o arquivo de backup.');
      return;
    }
    setBackupBusy(true);
    try {
      const blob = await exportarBackupLocal(senhaBackup);
      const nome = `logenxoval-backup-${new Date().toISOString().slice(0, 10)}${EXTENSAO_BACKUP}`;
      const metodo = await salvarComDialogoOuDownload(blob, nome, 'application/octet-stream');
      if (metodo === 'cancelado') {
        toast.error('Exportação cancelada — nenhum arquivo foi salvo.');
        return;
      }
      setBackupFeito({ nome, metodo, blob, senha: senhaBackup });
      setSenhaBackup('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar o backup.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function compartilharBackup() {
    if (!backupFeito) return;
    setCompartilhando(true);
    const ok = await compartilharArquivo(backupFeito.blob, backupFeito.nome);
    setCompartilhando(false);
    if (!ok) toast.error('Compartilhamento indisponível — transfira o arquivo por outro meio (WhatsApp, e-mail, pen drive).');
  }

  async function importarDeArquivo(file: File) {
    if (!senhaBackup) {
      toast.error('Informe a senha usada no backup antes de importar.');
      return;
    }
    setBackupBusy(true);
    try {
      const conteudo = await file.text();
      await importarBackupLocal(senhaBackup, conteudo);
      toast.success('Restauração aplicada. Na próxima sincronização o servidor re-confirma os operationIds preservados.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar o backup.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restaurar() {
    if (!restaurando || !depositoId) return;
    if (!motivo.trim() || !matricula.trim()) {
      toast.error('Motivo e matrícula de confirmação são obrigatórios.');
      return;
    }
    setRestaurarBusy(true);
    try {
      const res = await restaurarSnapshotV12(api, {
        depositoId,
        snapshotId: restaurando.id,
        motivo: motivo.trim(),
        matriculaConfirmacao: matricula.trim(),
        pin: pin || undefined,
      });
      toast.success(`Restaurado: nova versão ${res.versao.versao} publicada com ${res.itens.length} itens. Goldbox e logs preservados.`);
      setMotivo('');
      setPin('');
      setRestaurando(null);
      await carregarSnapshots();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MATRICULA_INVALIDA') {
        toast.error('Matrícula de confirmação não confere com o usuário logado.');
      } else if (isNetworkError(err)) {
        toast.error('Sem conexão com o servidor para restaurar.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Falha na restauração.');
      }
    } finally {
      setRestaurarBusy(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <div>
            <div className="list-title">Backup do dispositivo (.lxb)</div>
            <div className="list-sub">
              Exporta espelhos, fila e configurações criptografados com a sua senha (PBKDF2 + AES-GCM).
              A sessão atual não é incluída — a restauração preserva operationIds para sincronizar sem duplicar.
            </div>
          </div>
        </div>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <Field
            id="senha-backup"
            type="password"
            label="Senha do backup"
            placeholder="Senha usada para cifrar o arquivo"
            value={senhaBackup}
            onChange={(e) => setSenhaBackup(e.target.value)}
          />
        </div>
        <div className="list-item" style={{ borderBottom: 'none' }}>
          <Btn onClick={() => void exportar()} disabled={backupBusy}>
            {backupBusy ? 'Processando…' : 'Exportar .lxb'}
          </Btn>
          <Btn
            variant="secondary"
            disabled={backupBusy}
            onClick={() => fileRef.current?.click()}
            style={{ marginLeft: '0.5rem' }}
          >
            Importar backup
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept={EXTENSAO_BACKUP}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importarDeArquivo(f);
              e.target.value = '';
            }}
          />
        </div>
        {backupFeito && (
          <div className="card" style={{ marginTop: '0.8rem', border: '1px solid var(--line)', borderRadius: '8px', padding: '0.8rem' }}>
            <div className="list-title ok">Backup pronto: {backupFeito.nome}</div>
            <div className="list-sub" style={{ marginTop: '0.4rem' }}>
              {backupFeito.metodo === 'salvo'
                ? `Arquivo salvo no local que você escolheu. Se preferir enviar para outro aparelho agora, use o botão abaixo.`
                : `Download iniciado. Confira a barra de notificações (celular) ou a pasta Downloads (computador).`}
            </div>
            <div className="list-sub" style={{ marginTop: '0.4rem' }}>
              Para usar no outro aparelho: transfira o .lxb (WhatsApp, e-mail, pen drive ou pelo botão Compartilhar) e lá
              importe usando a <b>mesma senha do backup</b>.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
              {podeCompartilharArquivos() && (
                <Btn variant="secondary" className="small" disabled={compartilhando} onClick={() => void compartilharBackup()}>
                  {compartilhando ? 'Compartilhando…' : 'Compartilhar arquivo'}
                </Btn>
              )}
              <Btn variant="ghost" className="small" onClick={() => setBackupFeito(null)}>
                Fechar
              </Btn>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">Meu PIN</div>
            <div className="list-sub">
              O PIN é exigido nas confirmações sensíveis (designações, restaurações, desbloqueio de depósito). Cadastre
              ou troque o seu PIN aqui.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
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
          />
        </div>
        <Btn onClick={() => void alterarPin()} disabled={pinBusy}>
          {pinBusy ? 'Salvando…' : 'Alterar meu PIN'}
        </Btn>
      </div>

      <div className="card">
        <div className="list-item">
          <div>
            <div className="list-title">Restauração de versão (servidor)</div>
            <div className="list-sub">
              Restaura o enxoval para um ponto de restauração. Cria uma nova versão (a atual vira SUBSTITUIDA),
              preserva histórico, Goldbox e logs.
            </div>
          </div>
        </div>

        {!podeRestaurar && <Alert kind="warn">Seu perfil não permite restaurar — ação restrita a líderes e administradores.</Alert>}

        {podeRestaurar && !online && <Alert kind="warn">Offline: a lista de pontos de restauração precisa de conexão.</Alert>}

        {podeRestaurar && online && snapshots !== null && snapshots.length === 0 && (
          <Alert kind="info">Nenhum ponto de restauração registrado para este depósito.</Alert>
        )}

        {podeRestaurar && online && snapshots?.map((s) => {
          const abrindo = restaurando?.id === s.id;
          return (
            <div className="list-item" key={s.id}>
              <div style={{ flex: 1 }}>
                <div className="list-title">{s.titulo}</div>
                <div className="list-sub">
                  {s.tipo} · {dataCurta(s.dataEm)} · {s.matricula}
                  {s.motivo ? ` — ${s.motivo}` : ''}
                </div>
              </div>
              {!abrindo && (
                <Btn variant="secondary" className="small" onClick={() => setRestaurando(s)}>
                  Restaurar
                </Btn>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={restaurando !== null}
        title="Confirmar restauração"
        message={
          restaurando
            ? `Restaurar o enxoval para "${restaurando.titulo}" (${restaurando.tipo}, ${dataCurta(restaurando.dataEm)})? Uma nova versão será publicada.`
            : undefined
        }
        confirmLabel="Confirmar restauração"
        danger
        busy={restaurarBusy}
        onConfirm={() => void restaurar()}
        onCancel={() => setRestaurando(null)}
      >
        <Field id="motivo-r" label="Motivo (obrigatório)" placeholder="Ex.: inconsistência detectada na conferência" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        <Field id="matricula-r" label="Matrícula de confirmação" value={matricula} onChange={(e) => setMatricula(e.target.value)} required placeholder="000123" />
        <Field id="pin-r" type="password" label="Seu PIN (se definido)" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
      </ConfirmDialog>
    </div>
  );
}