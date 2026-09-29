import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ConsumableRow, PpeItemRow, SolicitacaoTipo } from '@logenxoval/contracts';
import { useAuth } from '../auth/AuthContext';
import { Alert, Btn, Field } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toasts';
import { assinarMatricula } from '../lib/assinatura';
import { filtrarPorBusca, resumoDeEstoque } from '../lib/estoque';
import {
  listConsumiveisLocal,
  listPpeLocal,
  registrarEntradaEstoqueOffline,
  registrarSolicitacaoOffline,
} from '../repos/local';
import { espelharEstoque } from '../services/sync';

export type EstoqueRow = ConsumableRow | PpeItemRow;

interface EstoqueCatalogoProps {
  tipo: SolicitacaoTipo;
  titulo: string;
  singular: string;
}

/**
 * Fase 21: painel de catálogo de consumíveis/EPIs. Gerencia (cadastrar, editar,
 * excluir, listar) os itens do depósito — qualquer usuário — e permite solicitar
 * marcando os itens desejados e enviando. Entrada (recepção) segue Líder/Admin.
 */
export function EstoqueCatalogo({ tipo, titulo, singular }: EstoqueCatalogoProps) {
  const { api, session, online, deviceId } = useAuth();
  const toast = useToast();

  const depositoId = session?.depositoAtivo?.id ?? '';
  const perfil = session?.perfil ?? '';
  const podeEntrada = perfil === 'LIDER' || perfil === 'ADMIN';

  const [itens, setItens] = useState<EstoqueRow[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);

  // Cadastro direto no catálogo
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [cadCodigo, setCadCodigo] = useState('');
  const [cadDescricao, setCadDescricao] = useState('');
  const [cadUnidade, setCadUnidade] = useState('');
  const [cadMinimo, setCadMinimo] = useState('');
  const [cadBusy, setCadBusy] = useState(false);

  // Edição de item
  const [edicaoAlvo, setEdicaoAlvo] = useState<EstoqueRow | null>(null);
  const [edCodigo, setEdCodigo] = useState('');
  const [edDescricao, setEdDescricao] = useState('');
  const [edUnidade, setEdUnidade] = useState('');
  const [edMinimo, setEdMinimo] = useState('');
  const [edBusy, setEdBusy] = useState(false);

  // Entrada (recepção) — Líder/Admin
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [entCodigo, setEntCodigo] = useState('');
  const [entDescricao, setEntDescricao] = useState('');
  const [entUnidade, setEntUnidade] = useState('');
  const [entMinimo, setEntMinimo] = useState('');
  const [entQtd, setEntQtd] = useState('');
  const [entObservacao, setEntObservacao] = useState('');
  const [entBusy, setEntBusy] = useState(false);

  // Seleção para solicitar (tick + enviar)
  const [selecionando, setSelecionando] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [solicBusy, setSolicBusy] = useState(false);

  // Exclusão
  const [excluirAlvo, setExcluirAlvo] = useState<EstoqueRow | null>(null);
  const [excluirMotivo, setExcluirMotivo] = useState('');
  const [excluirMatricula, setExcluirMatricula] = useState('');
  const [excluirBusy, setExcluirBusy] = useState(false);

  const recarregar = useCallback(async () => {
    if (!depositoId) return;
    setCarregando(true);
    if (online) {
      try {
        await espelharEstoque(api, depositoId);
      } catch {
        // segue com o espelho local
      }
    }
    const rows = tipo === 'CONSUMIVEL'
      ? await listConsumiveisLocal(depositoId)
      : await listPpeLocal(depositoId);
    setItens(rows);
    setCarregando(false);
  }, [api, depositoId, online, tipo]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (!session || !session.depositoAtivo) {
    return <Alert kind="warn">Selecione um depósito ativo para acessar {titulo.toLowerCase()}.</Alert>;
  }

  const visiveis = filtrarPorBusca(itens, busca, (r) => `${r.codigo} ${r.descricao}`);
  const resumo = resumoDeEstoque(itens);
  const selecionados = visiveis.filter((r) => sel[r.id]);

  const limparSelecao = () => {
    setSelecionando(false);
    setSel({});
    setQtds({});
  };

  const criarItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!online) {
      toast.error('Cadastro de item requer conexão.');
      return;
    }
    const codigo = cadCodigo.trim();
    const descricao = cadDescricao.trim();
    if (!codigo || !descricao) {
      toast.error('Informe código e descrição.');
      return;
    }
    setCadBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request(
        'POST',
        `/deposits/${depositoId}/estoque/${tipo}`,
        {
          codigo,
          descricao,
          unidade: cadUnidade.trim() || undefined,
          estoqueMinimo: cadMinimo.trim() ? Number(cadMinimo) : undefined,
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: session.matricula,
        },
      );
      toast.success('Item cadastrado no catálogo.');
      setCadastroAberto(false);
      setCadCodigo('');
      setCadDescricao('');
      setCadUnidade('');
      setCadMinimo('');
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao cadastrar item');
    } finally {
      setCadBusy(false);
    }
  };

  const abrirEdicao = (item: EstoqueRow) => {
    setEdicaoAlvo(item);
    setEdCodigo(item.codigo);
    setEdDescricao(item.descricao);
    setEdUnidade(item.unidade === 'unidade' ? '' : item.unidade);
    setEdMinimo(String(item.estoqueMinimo));
  };

  const salvarEdicao = async () => {
    if (!edicaoAlvo || !online) {
      toast.error('Edição requer conexão.');
      return;
    }
    const codigo = edCodigo.trim();
    const descricao = edDescricao.trim();
    if (!codigo || !descricao) {
      toast.error('Informe código e descrição.');
      return;
    }
    setEdBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      await api.request(
        'PUT',
        `/deposits/${depositoId}/estoque/${tipo}/${edicaoAlvo.id}`,
        {
          codigo,
          descricao,
          unidade: edUnidade.trim() || undefined,
          estoqueMinimo: edMinimo.trim() ? Number(edMinimo) : undefined,
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: session.matricula,
        },
      );
      toast.success('Item atualizado.');
      setEdicaoAlvo(null);
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao editar item');
    } finally {
      setEdBusy(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluirAlvo || !online) return;
    setExcluirBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const res = await api.request<{ solicitacoesExcluidas: number }>(
        'POST',
        `/deposits/${depositoId}/estoque/${tipo}/${excluirAlvo.id}/excluir`,
        {
          motivo: excluirMotivo.trim(),
          assinaturaMatricula: assinatura,
          matriculaConfirmacao: excluirMatricula.trim() || session.matricula,
        },
      );
      toast.success(
        `Item excluído do catálogo${res.solicitacoesExcluidas > 0 ? ` · ${res.solicitacoesExcluidas} solicitação(ões) encerrada(s)` : ''}.`,
      );
      setExcluirAlvo(null);
      setExcluirMotivo('');
      setExcluirMatricula('');
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir item.');
    } finally {
      setExcluirBusy(false);
    }
  };

  const preencherEntrada = () => {
    const codigo = entCodigo.trim().toUpperCase();
    if (!codigo) return;
    const achado = itens.find((r) => r.codigo.trim().toUpperCase() === codigo);
    if (achado) {
      setEntDescricao(achado.descricao);
      setEntUnidade(achado.unidade === 'unidade' ? '' : achado.unidade);
      setEntMinimo(String(achado.estoqueMinimo));
    }
  };

  const registrarEntrada = async (e: FormEvent) => {
    e.preventDefault();
    if (!podeEntrada) {
      toast.error(`Entrada de ${singular} exige perfil Líder ou Admin.`);
      return;
    }
    const codigo = entCodigo.trim().toUpperCase();
    if (!codigo) {
      toast.error('Informe o código do item.');
      return;
    }
    const qty = Number(entQtd);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Quantidade precisa ser maior que zero.');
      return;
    }
    if (!entDescricao.trim()) {
      toast.error('Informe a descrição do item.');
      return;
    }
    setEntBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const observacao = entObservacao.trim() || undefined;
      const unidade = entUnidade.trim() || undefined;
      const estoqueMinimo = entMinimo.trim() ? Number(entMinimo) : undefined;
      if (online) {
        const res = await api.request<{ saldo: number; criado: boolean; jaProcessada: boolean }>(
          'POST',
          `/deposits/${depositoId}/estoque/entrada`,
          {
            operationId: crypto.randomUUID(),
            tipo,
            codigo,
            descricao: entDescricao.trim(),
            unidade,
            estoqueMinimo,
            quantidade: qty,
            observacao,
            origem: 'ONLINE',
            dispositivo: deviceId,
            dataHora: new Date().toISOString(),
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        toast.success(
          res.jaProcessada
            ? 'Operação já processada anteriormente (idempotente).'
            : `Entrada registrada${res.criado ? ' · item criado no catálogo' : ''}. Saldo atual: ${res.saldo}`,
        );
      } else {
        await registrarEntradaEstoqueOffline({
          operationId: crypto.randomUUID(),
          depositoId,
          tipo,
          codigo,
          descricao: entDescricao.trim(),
          unidade,
          estoqueMinimo,
          quantidade: qty,
          observacao,
          dataHora: new Date().toISOString(),
          usuarioId: session.userId,
          matricula: session.matricula,
          dispositivo: deviceId,
          assinaturaMatricula: assinatura,
        });
        toast.info('Entrada registrada offline — sincroniza quando reconectar.');
      }
      setEntradaAberta(false);
      setEntCodigo('');
      setEntDescricao('');
      setEntUnidade('');
      setEntMinimo('');
      setEntQtd('');
      setEntObservacao('');
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao registrar entrada');
    } finally {
      setEntBusy(false);
    }
  };

  const enviarSolicitacao = async () => {
    const escolhidos = selecionados
      .map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        qtd: Number(qtds[r.id] ?? '') || 1,
      }))
      .filter((i) => i.qtd > 0);
    if (escolhidos.length === 0) {
      toast.error(`Marque ao menos um item para solicitar ${titulo.toLowerCase()}.`);
      return;
    }
    setSolicBusy(true);
    try {
      const assinatura = await assinarMatricula(session.matricula);
      const operationId = crypto.randomUUID();
      if (online) {
        await api.request(
          'POST',
          `/deposits/${depositoId}/requests`,
          {
            operationId,
            tipo,
            itens: escolhidos,
            enviar: true,
            assinaturaMatricula: assinatura,
            matriculaConfirmacao: session.matricula,
          },
        );
        toast.success('Solicitação enviada.');
      } else {
        await registrarSolicitacaoOffline({
          operationId,
          depositoId,
          tipo,
          itens: escolhidos,
          solicitanteId: session.userId,
          matricula: session.matricula,
          enviar: true,
          assinaturaMatricula: assinatura,
        });
        toast.info('Solicitação enviada offline — sincroniza quando reconectar.');
      }
      limparSelecao();
      await recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar solicitação');
    } finally {
      setSolicBusy(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item">
          <div>
            <div className="list-title">{session.depositoAtivo.nome} · {titulo}</div>
            <div className="list-sub">
              {resumo.totalItens} itens · {resumo.totalUnidades} un. · {resumo.abaixoMinimo} abaixo do mínimo
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="list-item" style={{ flexWrap: 'wrap' }}>
          <Field id="busca-estoque" placeholder="Buscar por código ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {!cadastroAberto && !entradaAberta && !selecionando && (
            <>
              <Btn variant="secondary" onClick={() => setCadastroAberto(true)}>+ Cadastrar</Btn>
              {podeEntrada && (
                <Btn variant="secondary" onClick={() => setEntradaAberta(true)}>+ Entrada (recepção)</Btn>
              )}
              <Btn onClick={() => setSelecionando(true)}>Solicitar itens</Btn>
            </>
          )}
        </div>

        {cadastroAberto && (
          <form onSubmit={criarItem} style={{ marginTop: '0.6rem' }}>
            <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
              Cadastro de {singular} no catálogo (não movimenta estoque). O código é único no depósito.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.4rem' }}>
              <Field id="cad-codigo" label="Código" value={cadCodigo} onChange={(e) => setCadCodigo(e.target.value)} required />
              <Field id="cad-desc" label="Descrição" value={cadDescricao} onChange={(e) => setCadDescricao(e.target.value)} required />
              <Field id="cad-un" label="Unidade" value={cadUnidade} onChange={(e) => setCadUnidade(e.target.value)} placeholder="ex.: caixa, litro" />
              <Field id="cad-min" label="Estoque mínimo" type="number" min="0" value={cadMinimo} onChange={(e) => setCadMinimo(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <Btn type="submit" disabled={cadBusy}>{cadBusy ? 'Cadastrando…' : 'Cadastrar'}</Btn>
              <Btn variant="ghost" onClick={() => setCadastroAberto(false)}>Cancelar</Btn>
            </div>
          </form>
        )}

        {entradaAberta && (
          <form onSubmit={registrarEntrada} style={{ marginTop: '0.6rem' }}>
            <div className="list-sub" style={{ marginBottom: '0.4rem' }}>
              Recebimento de {singular}. Se o código ainda não estiver no catálogo, o item é criado na entrada.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.4rem' }}>
              <Field id="ent-codigo" label="Código do item" value={entCodigo} onChange={(e) => setEntCodigo(e.target.value)} onBlur={() => preencherEntrada()} required />
              <Field id="ent-desc" label="Descrição" value={entDescricao} onChange={(e) => setEntDescricao(e.target.value)} required />
              <Field id="ent-qtd" label="Quantidade" type="number" min="0" value={entQtd} onChange={(e) => setEntQtd(e.target.value)} required />
              <Field id="ent-un" label="Unidade" value={entUnidade} onChange={(e) => setEntUnidade(e.target.value)} placeholder="ex.: caixa, litro" />
              <Field id="ent-min" label="Estoque mínimo" type="number" min="0" value={entMinimo} onChange={(e) => setEntMinimo(e.target.value)} />
            </div>
            <Field id="ent-obs" label="Observação" value={entObservacao} onChange={(e) => setEntObservacao(e.target.value)} placeholder="Opcional (ex.: NF 12345)" />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <Btn type="submit" disabled={entBusy}>{entBusy ? 'Registrando…' : online ? 'Registrar entrada' : 'Registrar (offline — vai para a fila)'}</Btn>
              <Btn variant="ghost" onClick={() => setEntradaAberta(false)}>Cancelar</Btn>
            </div>
          </form>
        )}

        {selecionando && (
          <div className="list-sub" style={{ marginTop: '0.4rem' }}>
            Marque os {titulo.toLowerCase()} que você precisa e informe a quantidade. Depois envie a solicitação.
          </div>
        )}

        <div style={{ marginTop: '0.4rem' }}>
          {carregando && visiveis.length === 0 && <div className="list-sub">Carregando…</div>}
          {!carregando && visiveis.length === 0 && <div className="list-sub">Nenhum item encontrado.</div>}
          {visiveis.map((r) => {
            const marcado = sel[r.id] ?? false;
            return (
              <div key={r.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                {selecionando && (
                  <input
                    type="checkbox"
                    aria-label={`selecionar ${r.codigo}`}
                    style={{ marginRight: '0.6rem' }}
                    checked={marcado}
                    onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div className="list-title">{r.codigo} · {r.descricao}</div>
                  <div className="list-sub">
                    em estoque <strong>{r.estoqueAtual}</strong> {r.unidade} · mínimo {r.estoqueMinimo}
                  </div>
                </div>
                {r.estoqueAtual < r.estoqueMinimo && <span className="chip warn">abaixo do mínimo</span>}
                {selecionando && marcado && (
                  <div style={{ width: '6rem' }}>
                    <Field
                      id={`qtd-${r.id}`}
                      label="Qtd"
                      type="number"
                      min="1"
                      value={qtds[r.id] ?? '1'}
                      onChange={(e) => setQtds({ ...qtds, [r.id]: e.target.value })}
                    />
                  </div>
                )}
                {!selecionando && (
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <Btn variant="ghost" className="small" onClick={() => abrirEdicao(r)}>Editar</Btn>
                    <Btn
                      variant="ghost"
                      className="small"
                      onClick={() => {
                        if (!online) {
                          toast.error('Exclusão requer conexão.');
                          return;
                        }
                        setExcluirAlvo(r);
                        setExcluirMotivo('');
                        setExcluirMatricula(session.matricula);
                      }}
                    >
                      Excluir
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selecionando && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Btn disabled={solicBusy || selecionados.length === 0} onClick={() => void enviarSolicitacao()}>
              {solicBusy ? 'Enviando…' : `Enviar solicitação (${selecionados.length})`}
            </Btn>
            <Btn variant="ghost" onClick={limparSelecao}>Cancelar</Btn>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={edicaoAlvo !== null}
        title={`Editar ${singular}`}
        message={edicaoAlvo ? `${edicaoAlvo.codigo} · ${edicaoAlvo.descricao}` : ''}
        confirmLabel="Salvar alterações"
        busy={edBusy}
        onConfirm={() => void salvarEdicao()}
        onCancel={() => setEdicaoAlvo(null)}
      >
        <Field id="ed-codigo" label="Código" value={edCodigo} onChange={(e) => setEdCodigo(e.target.value)} required />
        <Field id="ed-desc" label="Descrição" value={edDescricao} onChange={(e) => setEdDescricao(e.target.value)} required />
        <Field id="ed-un" label="Unidade" value={edUnidade} onChange={(e) => setEdUnidade(e.target.value)} placeholder="ex.: caixa, litro" />
        <Field id="ed-min" label="Estoque mínimo" type="number" min="0" value={edMinimo} onChange={(e) => setEdMinimo(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={excluirAlvo !== null}
        title={`Excluir ${singular} do catálogo`}
        message={
          excluirAlvo
            ? `Remove ${excluirAlvo.codigo} · ${excluirAlvo.descricao} e o histórico de movimentos. Solicitações abertas deste item são encerradas. Esta ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Confirmar exclusão"
        danger
        busy={excluirBusy}
        onConfirm={() => void confirmarExclusao()}
        onCancel={() => { setExcluirAlvo(null); setExcluirMotivo(''); setExcluirMatricula(''); }}
      >
        <Field id="ex-motivo" label="Motivo" value={excluirMotivo} onChange={(e) => setExcluirMotivo(e.target.value)} required placeholder="Ex.: lançamento incorreto" />
        <Field id="ex-mat" label="Matrícula de confirmação" value={excluirMatricula} onChange={(e) => setExcluirMatricula(e.target.value)} required />
      </ConfirmDialog>
    </div>
  );
}
