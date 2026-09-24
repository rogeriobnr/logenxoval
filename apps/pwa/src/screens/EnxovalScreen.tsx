import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { DepositVersionRow, InventoryItemRow } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { parseLinhasEnxoval } from '../lib/enxoval';
import { navigate } from '../router';
import {
  getEnxovalAtualLocal,
  listInventoryItemsLocal,
  listVersionsLocal,
  upsertInventoryItems,
  upsertVersions,
} from '../repos/local';

export function EnxovalScreen() {
  const { api, session } = useAuth();
  const [itens, setItens] = useState<InventoryItemRow[]>([]);
  const [versao, setVersao] = useState<DepositVersionRow | null>(null);
  const [versoes, setVersoes] = useState<DepositVersionRow[]>([]);
  const [busca, setBusca] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const [linhas, setLinhas] = useState('');
  const [refFolha, setRefFolha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const podeImportar = perfil === 'LIDER' || perfil === 'ADMIN';

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para consultar o enxoval.</Alert>;
  }

  const carregarVersoes = useCallback(async (): Promise<DepositVersionRow[]> => {
    if (navigator.onLine) {
      const res = await api.request<{ versoes: DepositVersionRow[] }>(
        'GET',
        `/deposits/${depositoId}/enxoval/versions`,
      );
      await upsertVersions(res.versoes);
      return res.versoes;
    }
    return listVersionsLocal(depositoId);
  }, [api, depositoId]);

  const carregarVersao = useCallback(async () => {
    if (navigator.onLine) {
      const res = await api.request<{
        versao: DepositVersionRow | null;
        itens: InventoryItemRow[];
      }>('GET', `/deposits/${depositoId}/enxoval`);
      setItens(res.itens);
      setVersao(res.versao);
      await upsertInventoryItems(res.itens);
      if (res.versao) await upsertVersions([res.versao]);
      setLoadError(null);
    } else {
      const local = await getEnxovalAtualLocal(depositoId);
      setItens(local.itens);
      setVersao(local.versao);
      setLoadError('Modo offline — exibindo espelho local.');
    }
  }, [api, depositoId]);

  const carregar = useCallback(async () => {
    try {
      await carregarVersao();
      const versoes = await carregarVersoes();
      setVersoes(versoes);
    } catch (err) {
      const local = await getEnxovalAtualLocal(depositoId);
      setItens(local.itens);
      setVersao(local.versao);
      setLoadError(err instanceof Error ? `Falha na rede — usando espelho local. ${err.message}` : 'Falha ao carregar o enxoval.');
    }
  }, [carregarVersao, carregarVersoes, depositoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abertos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(
      (i) =>
        i.codigoSap.toLowerCase().includes(q) ||
        i.textoBreve.toLowerCase().includes(q) ||
        (i.materialId ?? '').toLowerCase().includes(q),
    );
  }, [itens, busca]);

  const verVersao = async (id: string) => {
    if (navigator.onLine) {
      const res = await api.request<{ versao: DepositVersionRow; itens: InventoryItemRow[] }>(
        'GET',
        `/deposits/${depositoId}/enxoval/versions/${id}`,
      );
      setItens(res.itens);
      setVersao(res.versao);
      setLoadError(null);
    } else {
      const todos = await listInventoryItemsLocal(depositoId);
      setItens(todos.filter((i) => i.versao === id));
      setVersao(versoes.find((v) => v.id === id) ?? null);
    }
  };

  const importar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormMsg(null);
    const { itens: parsed, erros } = parseLinhasEnxoval(linhas);
    if (erros.length > 0) {
      setFormMsg({ kind: 'error', text: `Corrija as linhas inválidas: ${erros.join('; ')}` });
      setBusy(false);
      return;
    }
    if (parsed.length === 0) {
      setFormMsg({ kind: 'error', text: 'Informe ao menos um item.' });
      setBusy(false);
      return;
    }
    try {
      await api.request('POST', `/deposits/${depositoId}/enxoval/import`, {
        refFolha: refFolha.trim() || undefined,
        motivo: motivo.trim(),
        matriculaConfirmacao: session?.matricula ?? '',
        pin: pin.trim() || undefined,
        itens: parsed.map((p) => ({
          codigoSap: p.codigoSap,
          textoBreve: p.textoBreve,
          qtdOficial: p.qtdOficial,
          qtdAtual: p.qtdOficial,
          utilizacaoLivre: false,
          unidadeMedida: p.unidadeMedida,
        })),
      });
      setLinhas('');
      setRefFolha('');
      setMotivo('');
      setPin('');
      setFormMsg({ kind: 'info', text: `Enxoval publicado (${parsed.length} item(ns)).` });
      await carregar();
    } catch (err) {
      setFormMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao importar enxoval.' });
    }
    setBusy(false);
  };

  return (
    <div>
      <h2 className="screen-title">Enxoval</h2>
      <div className="list-sub" style={{ marginBottom: '0.5rem' }}>
        {versao ? `Versão ${versao.versao} · ${new Date(versao.dataEm).toLocaleString('pt-BR')} · por ${versao.matricula}` : 'Sem enxoval publicado ainda'}
        {loadError ? ` · ${loadError}` : ''}
      </div>

      <Field
        id="enx-busca"
        label="Buscar"
        placeholder="Código SAP, descrição ou material"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      <div className="card" style={{ marginTop: '0.8rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Itens ({abertos.length})</h3>
          {versoes.length > 1 && (
            <Btn variant="ghost" className="small" onClick={() => setVerHistorico((v) => !v)}>
              {verHistorico ? 'Ocultar versões' : `Versões (${versoes.length})`}
            </Btn>
          )}
        </div>

        {verHistorico && (
          <div className="card" style={{ marginBottom: '0.8rem', background: 'transparent' }}>
            {versoes.map((v) => (
              <div key={v.id} className="list-item">
                <div>
                  <div className="list-title">Versão {v.versao}</div>
                  <div className="list-sub">
                    {v.status} · {new Date(v.dataEm).toLocaleString('pt-BR')} · {v.matricula}
                  </div>
                  {v.motivo && <div className="list-sub">{v.motivo}</div>}
                </div>
                <Btn variant="secondary" className="small" onClick={() => verVersao(v.id)}>
                  Ver
                </Btn>
              </div>
            ))}
            {versao && (
              <Btn variant="ghost" className="small" onClick={() => carregarVersao()}>
                Voltar à versão atual
              </Btn>
            )}
          </div>
        )}

        {abertos.length === 0 && !loadError && (
          <Alert kind="info">Nenhum item encontrado para esta busca (ou enxoval ainda não importado).</Alert>
        )}
        {abertos.map((i) => (
          <div key={i.id} className="list-item">
            <div>
              <div className="list-title">
                {i.codigoSap} · {i.textoBreve}
              </div>
              <div className="list-sub">
                saldo {i.qtdAtual} / oficial {i.qtdOficial} {i.unidadeMedida ?? ''} · {i.status}
              </div>
            </div>
            <div className={i.qtdAtual < 0 ? 'list-title warn' : 'list-title'} style={{ fontWeight: 600 }}>
              {i.qtdAtual}
            </div>
          </div>
        ))}
      </div>

      {podeImportar && (
        <>
          <div className="card" style={{ marginTop: '0.8rem' }}>
            <div className="list-item">
              <div>
                <div className="list-title">Atualizar enxoval por foto / PDF (OCR)</div>
                <div className="list-sub">Fotografe a folha, confira os itens reconhecidos e publique a nova versão.</div>
              </div>
              <Btn onClick={() => navigate('/revisao-ocr')}>📷 Capturar folha</Btn>
            </div>
          </div>
          <div className="card" style={{ marginTop: '0.8rem' }}>
            <h3>Importar nova versão</h3>
          <p className="muted">
            Uma linha por item no formato <code>codigoSap|textoBreve|qtdOficial|unidade</code> (unidade opcional).
          </p>
          <form onSubmit={importar}>
            <div className="field">
              <label htmlFor="enx-linhas">Itens</label>
              <textarea
                id="enx-linhas"
                rows={8}
                placeholder={'1002341|Parafuso M8x20|10|pç\n1002342|Porca M8|20|pç'}
                value={linhas}
                onChange={(e) => setLinhas(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <Field id="enx-ref" label="Referência da folha (opcional)" value={refFolha} onChange={(e) => setRefFolha(e.target.value)} />
            <Field id="enx-motivo" label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
            {formMsg && <Alert kind={formMsg.kind}>{formMsg.text}</Alert>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
              <Field id="enx-pin" label="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
              <Btn type="submit" disabled={busy}>
                {busy ? 'Publicando…' : 'Publicar versão'}
              </Btn>
            </div>
          </form>
          </div>
        </>
      )}
    </div>
  );
}