import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
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
  const depositoId = session?.depositoAtivo?.id;
  const podeRestaurar = !!session && session.perfil !== 'MECANICO';

  // Backup do dispositivo
  const [senhaBackup, setSenhaBackup] = useState('');
  const [msgBackup, setMsgBackup] = useState<{ kind: 'info' | 'error'; texto: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFeito, setBackupFeito] = useState<{ nome: string; metodo: 'salvo' | 'download'; blob: Blob; senha: string } | null>(null);
  const [compartilhando, setCompartilhando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Snapshots do servidor
  const [snapshots, setSnapshots] = useState<SnapshotListado[] | null>(null);
  const [snapErro, setSnapErro] = useState<string | null>(null);
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [matricula, setMatricula] = useState(session?.matricula ?? '');
  const [pin, setPin] = useState('');
  const [msgRestaurar, setMsgRestaurar] = useState<{ kind: 'info' | 'error'; texto: string } | null>(null);

  const carregarSnapshots = useCallback(async () => {
    if (!podeRestaurar || !depositoId || !online) return;
    setSnapErro(null);
    try {
      setSnapshots(await listarSnapshots(api, depositoId));
    } catch (err) {
      setSnapErro(
        isNetworkError(err)
          ? 'Offline: não foi possível carregar os pontos de restauração.'
          : err instanceof Error
            ? err.message
            : 'Falha ao carregar pontos de restauração.',
      );
      setSnapshots([]);
    }
  }, [api, depositoId, podeRestaurar, online]);

  useEffect(() => {
    void carregarSnapshots();
  }, [carregarSnapshots]);

  async function exportar() {
    setMsgBackup(null);
    setBackupFeito(null);
    if (!senhaBackup) {
      setMsgBackup({ kind: 'error', texto: 'Informe uma senha para o arquivo de backup.' });
      return;
    }
    setBackupBusy(true);
    try {
      const blob = await exportarBackupLocal(senhaBackup);
      const nome = `logenxoval-backup-${new Date().toISOString().slice(0, 10)}${EXTENSAO_BACKUP}`;
      const metodo = await salvarComDialogoOuDownload(blob, nome, 'application/octet-stream');
      if (metodo === 'cancelado') {
        setMsgBackup({ kind: 'error', texto: 'Exportação cancelada — nenhum arquivo foi salvo.' });
        return;
      }
      setBackupFeito({ nome, metodo, blob, senha: senhaBackup });
      setSenhaBackup('');
    } catch (err) {
      setMsgBackup({ kind: 'error', texto: err instanceof Error ? err.message : 'Falha ao gerar o backup.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function compartilharBackup() {
    if (!backupFeito) return;
    setCompartilhando(true);
    const ok = await compartilharArquivo(backupFeito.blob, backupFeito.nome);
    setCompartilhando(false);
    if (!ok) setMsgBackup({ kind: 'error', texto: 'Compartilhamento indisponível — transfira o arquivo por outro meio (WhatsApp, e-mail, pen drive).' });
  }

  async function importarDeArquivo(file: File) {
    setMsgBackup(null);
    if (!senhaBackup) {
      setMsgBackup({ kind: 'error', texto: 'Informe a senha usada no backup antes de importar.' });
      return;
    }
    setBackupBusy(true);
    try {
      const conteudo = await file.text();
      await importarBackupLocal(senhaBackup, conteudo);
      setMsgBackup({
        kind: 'info',
        texto: 'Restauração aplicada. Na próxima sincronização o servidor re-confirma os operationIds preservados.',
      });
    } catch (err) {
      setMsgBackup({ kind: 'error', texto: err instanceof Error ? err.message : 'Falha ao importar o backup.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function restaurar(snapshotId: string) {
    setMsgRestaurar(null);
    if (!depositoId) return;
    if (!motivo.trim() || !matricula.trim()) {
      setMsgRestaurar({ kind: 'error', texto: 'Motivo e matrícula de confirmação são obrigatórios.' });
      return;
    }
    setRestaurandoId(snapshotId);
    try {
      const res = await restaurarSnapshotV12(api, {
        depositoId,
        snapshotId,
        motivo: motivo.trim(),
        matriculaConfirmacao: matricula.trim(),
        pin: pin || undefined,
      });
      setMsgRestaurar({
        kind: 'info',
        texto: `Restaurado: nova versão ${res.versao.versao} publicada com ${res.itens.length} itens. Goldbox e logs preservados.`,
      });
      setMotivo('');
      setPin('');
      await carregarSnapshots();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MATRICULA_INVALIDA') {
        setMsgRestaurar({ kind: 'error', texto: 'Matrícula de confirmação não confere com o usuário logado.' });
      } else if (isNetworkError(err)) {
        setMsgRestaurar({ kind: 'error', texto: 'Sem conexão com o servidor para restaurar.' });
      } else {
        setMsgRestaurar({ kind: 'error', texto: err instanceof Error ? err.message : 'Falha na restauração.' });
      }
    } finally {
      setRestaurandoId(null);
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
        {msgBackup && (
          <div className="list-item" style={{ borderBottom: 'none' }}>
            <Alert kind={msgBackup.kind}>{msgBackup.texto}</Alert>
          </div>
        )}

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

        {podeRestaurar && online && snapErro && <Alert kind="error">{snapErro}</Alert>}

        {podeRestaurar && online && snapshots !== null && snapshots.length === 0 && (
          <Alert kind="info">Nenhum ponto de restauração registrado para este depósito.</Alert>
        )}

        {podeRestaurar && online && snapshots?.map((s) => {
          const abrindo = restaurandoId === s.id;
          return (
            <div className="list-item" key={s.id}>
              <div style={{ flex: 1 }}>
                <div className="list-title">{s.titulo}</div>
                <div className="list-sub">
                  {s.tipo} · {dataCurta(s.dataEm)} · {s.matricula}
                  {s.motivo ? ` — ${s.motivo}` : ''}
                </div>
                {abrindo && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <Field
                      id={`motivo-${s.id}`}
                      label="Motivo (obrigatório)"
                      placeholder="Ex.: inconsistência detectada na conferência"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                    />
                    <Field
                      id={`matricula-${s.id}`}
                      label="Matrícula de confirmação"
                      value={matricula}
                      onChange={(e) => setMatricula(e.target.value)}
                    />
                    <Field
                      id={`pin-${s.id}`}
                      type="password"
                      label="PIN administrativo (se configurado)"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <Btn variant="danger" disabled={restaurandoId !== null} onClick={() => void restaurar(s.id)}>
                        Confirmar restauração
                      </Btn>
                      <Btn variant="ghost" onClick={() => setRestaurandoId(null)} disabled={restaurandoId !== null}>
                        Cancelar
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
              {!abrindo && (
                <Btn variant="secondary" className="small" onClick={() => setRestaurandoId(s.id)}>
                  Restaurar
                </Btn>
              )}
            </div>
          );
        })}

        {msgRestaurar && (
          <div className="list-item" style={{ borderBottom: 'none' }}>
            <Alert kind={msgRestaurar.kind}>{msgRestaurar.texto}</Alert>
          </div>
        )}
      </div>
    </div>
  );
}