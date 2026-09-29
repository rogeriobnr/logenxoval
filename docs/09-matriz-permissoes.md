# 09 — Matriz de Permissões

Legenda: ✅ permitido | ❌ negado | 🔒 com confirmação de matrícula | 🔑 requer o PIN do próprio usuário logado (se ele tiver PIN definido).

Operações do contexto de um depósito: **sempre** o depósito ativo autorizado ao usuário. Usuário nunca opera depósito não autorizado (verificado no servidor via RLS + validação).

| Operação | Mecânico | Líder | Admin |
| -------- | :------: | :---: | :----: |
| Login/logout, troca de usuário (logout) | ✅ | ✅ | ✅ |
| Ver dashboard, enxoval, goldbox, peças, consumíveis, EPIs, conferências, logs | ✅ | ✅ | ✅ |
| Realizar baixa no Goldbox | 🔒 | 🔒 | 🔒 |
| Conferência física (todas as etapas) | 🔒 | 🔒 | 🔒 |
| Propor correção em conferência | 🔒 | 🔒 | 🔒 |
| Estorno de baixa/correção | ❌ | 🔒🔑 | 🔒🔑 |
| Criar depósito | ❌ | 🔒🔑 | 🔒🔑 |
| Editar depósito | ❌ | 🔒🔑 | 🔒🔑 |
| Desativar depósito (lógico) | ❌ | 🔒🔑 | 🔒🔑 |
| Criar/editar enxoval | ❌ | 🔒🔑 | 🔒🔑 |
| Importar folha (OCR) | ❌ | 🔒🔑 | 🔒🔑 |
| Publicar nova versão do enxoval | ❌ | 🔒🔑 | 🔒🔑 |
| Restaurar ponto de restauração | ❌ | 🔒🔑 | 🔒🔑 |
| Desativar item do enxoval | ❌ | 🔒🔑 | 🔒🔑 |
| Aceitar/recusar sugestão de conversão | ❌ | 🔒 | 🔒 |
| Entrada/saída de peça avulsa | ✅ (saída/uso) | 🔒 | 🔒🔑 |
| Ajuste autorizado de peça avulsa | ❌ | 🔒🔑 | 🔒🔑 |
| Descarte de peça avulsa | ❌ | 🔒🔑 | 🔒🔑 |
| Criar solicitação de consumíveis/EPI | ✅ | ✅ | ✅ |
| Compartilhar solicitação própria (marca enviada) / excluir a própria | ✅ | ✅ | ✅ |
| Excluir solicitação de outro usuário | ❌ | ❌ | ❌ |
| Marcar recebimento da solicitação (itens não recebidos) | ❌ | 🔒 | 🔒 |
| Ver solicitações de outros usuários | ❌ | 🔒 | 🔒 |
| Cadastrar/editar/excluir item do catálogo de consumíveis/EPI (fase 21) | ✅ | ✅ | ✅ |
| Registrar entrada (compra) de consumível/EPI no estoque | ❌ | 🔒 | 🔒 |
| Editar conferência finalizada (autor) | 🔒 | ✅ | ✅ |
| Editar conferência finalizada (terceiro) | ❌ | 🔒🔑 | 🔒🔑 |
| Editar própria conferência | 🔒 | 🔒 | 🔒 |
| Gerenciar usuários completos (admin) | ❌ | ❌ | 🔒🔑 |
| Criar usuário MECANICO/LIDER e ver não-admins (líder) | ❌ | ✅ | ✅ |
| Redefinir PIN de outro usuário | ❌ | ❌ | 🔒🔑 |
| Designar/revogar depósito a usuário | ❌ | ❌ | 🔒🔑 |
| Ver logs usando critérios/calendário | ✅ | ✅ | ✅ |
| Exportar relatórios PDF/PNG/MD/JSON/CSV | ✅ | ✅ | ✅ |
| Backup de dispositivo | ✅ | ✅ | ✅ |
| Alterar o próprio PIN | 🔒 (cria/troca o seu) | 🔒 | 🔒 |

Regras de aplicação:

1. **Toda operação crítica** valida matrícula digitada (equivalente a assinatura).
2. **Operações críticas** exigem adicionalmente o **PIN do próprio usuário logado**, quando ele tiver PIN definido (`users.pin_hash`). Usuário sem PIN definido não precisa informar PIN; o admin pode criar/redefinir o PIN de qualquer usuário (e o próprio usuário, sempre que já tiver PIN, troca pelo dele — ver tela `Acesso`, que também tem “Esqueci meu PIN”).
3. Permissões conferidas **servidor** em toda rota; tabela local é só espelho para UX offline.
4. Mecânico não pode estornar, criar depósito, publicar versão, restaurar, aprovar solicitações, ajustar/descartar peça avulsa, registrar entrada de estoque, nem listar/gerenciar usuários. Desde a fase 21, **qualquer usuário com acesso ao depósito** (mecânico incluído) cadastra, edita e exclui itens do catálogo de consumíveis/EPIs.
5. **PIN nunca é exigido no fluxo de consumíveis/EPIs**: criar/editar/excluir item do catálogo, enviar solicitação e marcar recebimento exigem apenas a confirmação de matrícula — `APROVAR_SOLICITACAO` ficou fora de `ACTION_REQUIRES_PIN`.
6. **Fluxo das solicitações**: qualquer usuário do depósito cadastra o item do catálogo (sem quantidade) e solicita o que precisa, informando as quantidades — a solicitação nasce `ENVIADA`. O **mecânico vê apenas as próprias solicitações**; o **líder vê todas** para conferir a retirada no almoxarifado e **marcar como recebida** (`RECEBIDA`, com itens não recebidos). O solicitante recebe a confirmação pelo espelho. **Cada um limpa apenas o que é seu**: `EXCLUIDA` só pelo dono da solicitação (inclusive quando o dono é líder); a liderança não exclui a solicitação de outro. Estados areados são recusados pelo servidor (`CONFLITO`): não se recebe duas vezes nem se exclui o que já foi excluído.