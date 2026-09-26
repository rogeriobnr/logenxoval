import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItemRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import {
  confiancaDoCampo,
  extrairLinhas,
  itensParaPublicacao,
  OCR_CONFIANCA_LABEL,
  reconhecerComIa,
  reconhecerDocumento,
  revisarLinhas,
  tamanhoDeDocumento,
  type ItemRevisao,
} from '../lib/ocr';
import { ApiError, isNetworkError } from '../lib/api';
import { getEnxovalAtualLocal, registrarDocumentoOffline } from '../repos/local';
import { espelharEnxoval } from '../services/sync';

const MAX_UPLOAD = 20 * 1024 * 1024;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function OcrReviewScreen() {
  const { api, session, online } = useAuth();
  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const pode = perfil === 'LIDER' || perfil === 'ADMIN';

  const [itensAtuais, setItensAtuais] = useState<InventoryItemRow[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<'captura' | 'revisao'>('captura');
  const [reconhecendo, setReconhecendo] = useState(false);
  const [linhas, setLinhas] = useState<ItemRevisao[]>([]);
  const [refFolha, setRefFolha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [matricula, setMatricula] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'warn' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (!depositoId) return;
    try {
      if (navigator.onLine) await espelharEnxoval(api, depositoId);
    } catch {
      // segue com o espelho local
    }
    const local = await getEnxovalAtualLocal(depositoId);
    setItensAtuais(local.itens);
  }, [api, depositoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const { comparacao } = useMemo(
    () => (etapa === 'revisao' ? revisarLinhas(linhas, itensAtuais) : { comparacao: undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etapa, linhas, itensAtuais],
  );

  const atualizarLinha = (idx: number, patch: Partial<Pick<ItemRevisao, 'codigoSap' | 'textoBreve' | 'quantidade'>>) => {
    setLinhas((atuais) => atuais.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const aoSelecionar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD) {
      setMsg({ kind: 'error', text: 'Arquivo excede o limite de 20 MB.' });
      return;
    }
    const { tipo } = tamanhoDeDocumento(file);
    if (tipo !== 'FOTO' && tipo !== 'PDF') {
      setMsg({ kind: 'error', text: 'Formato não suportado (use imagem ou PDF).' });
      return;
    }
    setArquivo(file);
    setPreview(URL.createObjectURL(file));
    setEtapa('captura');
    if (navigator.onLine) {
      void reconhecerViaIa(file);
    } else {
      void reconhecerLocal(file);
    }
  };

  const aplicarTexto = (texto: string) => {
    const bruto = extrairLinhas(texto);
    if (bruto.length === 0) {
      setMsg({ kind: 'warn', text: 'Nenhum item reconhecido na folha. Ajuste o enquadramento e capture novamente.' });
      return;
    }
    const revisao = revisarLinhas(bruto, itensAtuais);
    setLinhas(revisao.linhas);
    setEtapa('revisao');
  };

  const reconhecerLocal = async (file: File) => {
    setReconhecendo(true);
    try {
      const texto = await reconhecerDocumento(file);
      aplicarTexto(texto);
      setMsg((m) => ({ kind: 'info', text: `Reconhecimento local (no aparelho). ${m?.text ?? ''}` }));
    } catch (err) {
      setMsg({
        kind: 'error',
        text: err instanceof Error ? `Falha no OCR: ${err.message}` : 'Falha ao reconhecer a folha.',
      });
    } finally {
      setReconhecendo(false);
    }
  };

  const reconhecerViaIa = async (file: File) => {
    setReconhecendo(true);
    try {
      const texto = await reconhecerComIa(file, depositoId, api);
      aplicarTexto(texto);
      setMsg({ kind: 'info', text: 'Itens reconhecidos por IA (Google Gemini). Confira e edite se necessário.' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IA_NAO_CONFIGURADA') {
        setMsg({ kind: 'info', text: 'IA não configurada neste servidor — usando o reconhecimento local (no aparelho).' });
        await reconhecerLocal(file);
        return;
      }
      if (isNetworkError(err) || (err instanceof ApiError && (err.code === 'IA_FALHOU' || err.code === 'VALIDATION_FAILED'))) {
        setMsg({ kind: 'info', text: 'IA indisponível — usando o reconhecimento local (no aparelho).' });
        await reconhecerLocal(file);
        return;
      }
      setMsg({
        kind: 'error',
        text: err instanceof Error ? `Falha no OCR por IA: ${err.message}` : 'Falha ao reconhecer a folha.',
      });
    } finally {
      setReconhecendo(false);
    }
  };

  const publicar = async () => {
    if (!session || !arquivo || !motivo.trim()) {
      setMsg({ kind: 'warn', text: 'Preencha o motivo e confirme a matrícula para publicar.' });
      return;
    }
    if (!matricula.trim()) {
      setMsg({ kind: 'warn', text: 'Digite sua matrícula para confirmar a publicação.' });
      return;
    }
    if (!online) {
      const tipo = tamanhoDeDocumento(arquivo).tipo;
      const bytes = await arquivo.arrayBuffer();
      try {
        await registrarDocumentoOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          tipo,
          nome: arquivo.name,
          mime: arquivo.type || 'application/octet-stream',
          tamanho: arquivo.size,
          hashDocumento: await sha256Hex(bytes),
          bytes,
          usuarioId: session.userId,
          matricula: session.matricula,
        });
        setMsg({
          kind: 'info',
          text: 'Sem conexão — a folha ficou preservada no aparelho; publique quando voltar a ficar online.',
        });
        setEtapa('captura');
        setArquivo(null);
        if (preview) {
          URL.revokeObjectURL(preview);
          setPreview(null);
        }
      } catch (err) {
        setMsg({
          kind: 'error',
          text: err instanceof Error ? `Falha ao preservar a folha: ${err.message}` : 'Falha ao preservar a folha.',
        });
      }
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // 1) preserva o documento original e faz upload (docs 6.1 / 12.6)
      const form = new FormData();
      form.append('file', arquivo, arquivo.name);
      const uploaded = await api.upload<{ documento: { id: string; hash: string } }>(
        `/documents?depositoId=${depositoId}`,
        form,
      );

      // 2) publica a nova versão com os itens revisados
      const res = await api.request<{ versao: { versao: number; refFolha?: string }; itens: InventoryItemRow[] }>(
        'POST',
        `/deposits/${depositoId}/enxoval/import`,
        {
          documentoId: uploaded.documento.id,
          refFolha: refFolha.trim() || undefined,
          motivo: motivo.trim(),
          matriculaConfirmacao: session.matricula,
          pin: pin.trim() || undefined,
          itens: itensParaPublicacao(linhas),
        },
      );
      setMsg({ kind: 'info', text: `Versão ${res.versao.versao} publicada com ${res.itens.length} item(ns).` });
      setEtapa('captura');
      setLinhas([]);
      setRefFolha('');
      setMotivo('');
      setPin('');
      setMatricula('');
      setArquivo(null);
      if (preview) {
        URL.revokeObjectURL(preview);
        setPreview(null);
      }
      await carregar();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao publicar versão.' });
    } finally {
      setBusy(false);
    }
  };

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para atualizar o enxoval.</Alert>;
  }
  if (!pode) {
    return <Alert kind="warn">Seu perfil não permite importar folhas (exige liderança).</Alert>;
  }

  if (etapa === 'captura') {
    return (
      <div>
        <div className="card">
          <div className="list-item">
            <div>
              <div className="list-title">Atualizar enxoval por foto / PDF</div>
              <div className="list-sub">
                {session.depositoAtivo.nome} · fotografe a folha. Online, os itens são reconhecidos por IA (Google
                Gemini); sem conexão, o reconhecimento roda no próprio aparelho.
              </div>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => void aoSelecionar(e)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Btn onClick={() => inputRef.current?.click()} disabled={reconhecendo} style={{ flex: 1 }}>
              {reconhecendo ? 'Reconhecendo folha…' : '📷 Fotografar / escolher arquivo'}
            </Btn>
          </div>
          {preview && (
            <div style={{ marginTop: '0.8rem' }}>
              <img src={preview} alt="Folha a reconhecer" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
            </div>
          )}
          {msg && <div style={{ marginTop: '0.8rem' }}><Alert kind={msg.kind}>{msg.text}</Alert></div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">Revisão da folha · {session.depositoAtivo.nome}</div>
            <div className="list-sub">
              {linhas.length} linha(s) reconhecida(s) — confira e edite antes de publicar (docs 6.4).
            </div>
          </div>
          <Btn variant="secondary" onClick={() => inputRef.current?.click()} disabled={reconhecendo}>
            Capturar outra folha
          </Btn>
        </div>
        {preview && <img src={preview} alt="Folha" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, marginTop: '0.4rem' }} />}
      </div>

      {msg && (
        <div style={{ marginBottom: '0.8rem' }}>
          <AlertChave msg={msg} />
        </div>
      )}

      <div className="card" style={{ marginBottom: '0.8rem' }}>
        <h3>Itens reconhecidos</h3>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {comparacao && (
            <>
              <ChipStatus status={comparacao.novos > 0 ? 'ok' : 'muted'} label={`➕ Novos: ${comparacao.novos}`} />
              <ChipStatus status={comparacao.removidos > 0 ? 'warn' : 'muted'} label={`➖ Removidos: ${comparacao.removidos}`} />
              <ChipStatus status={comparacao.qtdAlterados > 0 ? 'warn' : 'muted'} label={`🔁 Qtd alt: ${comparacao.qtdAlterados}`} />
              {comparacao.descAlterados > 0 && <ChipStatus status="warn" label={`✏️ Descrições: ${comparacao.descAlterados}`} />}
              {comparacao.duplicados > 0 && <ChipStatus status="err" label={`Duplicidades: ${comparacao.duplicados}`} />}
              {comparacao.invalidos > 0 && <ChipStatus status="err" label={`Inválidos: ${comparacao.invalidos}`} />}
            </>
          )}
        </div>
        {linhas.map((l, idx) => (
          <div key={l.id} className="list-item" style={{ borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
            <div style={{ minWidth: '1.4rem', paddingTop: '0.3rem' }} className="list-sub">{idx + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <div style={{ width: '7.5rem' }}>
                  <Field id={`oc-sap-${idx}`} label="Código" value={l.codigoSap} onChange={(e) => atualizarLinha(idx, { codigoSap: e.target.value })} />
                </div>
                <div style={{ flex: 1, minWidth: '10rem' }}>
                  <Field id={`oc-desc-${idx}`} label="Texto breve" value={l.textoBreve} onChange={(e) => atualizarLinha(idx, { textoBreve: e.target.value })} />
                </div>
                <div style={{ width: '5rem' }}>
                  <Field id={`oc-qtd-${idx}`} label="Qtd" type="number" min="0" value={String(l.quantidade ?? '')} onChange={(e) => atualizarLinha(idx, { quantidade: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                <span className={`chip ${confiancaDoCampo(l.confiancaCodigo)}`}>
                  Código: {OCR_CONFIANCA_LABEL[l.confiancaCodigo]}
                </span>
                <span className={`chip ${confiancaDoCampo(l.confiancaQtd)}`}>
                  Qtd: {OCR_CONFIANCA_LABEL[l.confiancaQtd]}
                </span>
                {l.ehNovo && <span className="chip primary">🟦 novo</span>}
                {l.duplicado && <span className="chip err">duplicado</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Publicar nova versão</h3>
        <Field id="oc-ref" label="Referência da folha (opcional)" value={refFolha} onChange={(e) => setRefFolha(e.target.value)} />
        <Field id="oc-motivo" label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
          <div style={{ flex: 1 }}>
            <Field id="oc-matricula" label="Confirme a matrícula" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder={session.matricula} required />
          </div>
          <div style={{ width: '9rem' }}>
            <Field id="oc-pin" label="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
          <Btn onClick={() => void publicar()} disabled={busy}>
            {busy ? 'Publicando…' : '📄 Publicar nova versão'}
          </Btn>
          <Btn variant="ghost" onClick={() => { setEtapa('captura'); setLinhas([]); }}>Cancelar</Btn>
        </div>
      </div>
    </div>
  );
}

function ChipStatus({ status, label }: { status: string; label: string }) {
  return <span className={`chip ${status}`}>{label}</span>;
}

function AlertChave({ msg }: { msg: { kind: 'error' | 'warn' | 'info'; text: string } }) {
  return <Alert kind={msg.kind}>{msg.text}</Alert>;
}