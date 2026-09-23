# 09 — Matriz de Permissões

Legenda: ✅ permitido | ❌ negado | 🔒 com confirmação de matrícula | 🔑 requer PIN administrativo adicional (settings).

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
| Editar/enviar/cancelar solicitação própria | ✅ | ✅ | ✅ |
| Aprovar/atender solicitação | ❌ | 🔒🔑 | 🔒🔑 |
| Editar conferência finalizada (autor) | 🔒 | ✅ | ✅ |
| Editar conferência finalizada (terceiro) | ❌ | 🔒🔑 | 🔒🔑 |
| Editar própria conferência | 🔒 | 🔒 | 🔒 |
| Gerenciar usuários (criar, bloquear, perfil) | ❌ | ❌ | 🔒🔑 |
| Ver logs usando critérios/calendário | ✅ | ✅ | ✅ |
| Exportar relatórios PDF/PNG/MD/JSON/CSV | ✅ | ✅ | ✅ |
| Backup de dispositivo | ✅ | ✅ | ✅ |
| Alterar configurações do app/pin | ❌ | 🔒🔑 | 🔒🔑 |

Regras de aplicação:

1. **Toda operação crítica** valida matrícula digitada (equivalente a assinatura).
2. **Admin crítico** exige adicionalmente PIN (hash) quando configurado.
3. Permissões conferidas **servidor** em toda rota; tabela local é só espelho para UX offline.
4. Mecânico não pode estornar, criar depósito, publicar versão, restaurar, aprovar solicitações, ajustar/descartar peça avulsa.