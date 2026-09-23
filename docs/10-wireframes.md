# 10 — Wireframes (mobile-first, 360–430px)

Barra superior fixa em **todas** as telas:

```
┌────────────────────────────┐
│ 👤 Nome S.   │ Dep 3216    │
│ MAT-000123   │ ● ONLINE  ⇄ │
└────────────────────────────┘
   (verde=online, vermelho=offline, ícone sync piscando=sincronizando)
```

---

## 10.1 Dashboard

```
┌────────────────────────────┐
│ 👤 João S.  MAT-001 │ Dep 3216 │   ← header
│              ● Sincronizado  │
├────────────────────────────┤
│  Depósito 3216  [Trocar]    │
│  Pendências na fila: 3  ⇄   │
│  Divergências abertas: 2 ⚠   │
│  Saldo negativo: 1          │
│  Reposições pendentes: 1    │
│  Últ. conferência: 12/08    │
│  Últ. sincronização: 02m    │
│  Sugestões de conversão: 2  │
│  [⟳ Sincronizar agora]      │
├────────────────────────────┤
│ [ Enxoval ] [ Goldbox ]     │
│ [ Peças avulsas] [ Consum.] │
│ [ EPIs ] [ Conferências ]   │
│ [ Solicitações ] [ Logs ]   │
│ [ Configurações ]           │
└────────────────────────────┘
```

---

## 10.2 Enxoval (lista granular)

```
┌────────────────────────────┐
│ Enxoval  Dep 3216   [●v3]  │
│ [Busca código/descrição...] │
│ ⟲ 1002341  Parafuso M8x20   │
│   qtd 40  ● Verde  ✓        │
│ ⟲ 1009987  Filtro óleo  ⚠-2 │  ← vermelho (negativo)
├────────────────────────────┤
│ [+] Atualizar Enxoval (OCR) │
└────────────────────────────┘
```

---

## 10.3 Goldbox (baixa — fluxo em etapas)

```
┌────────────────────────────┐
│ Baixa  Dep 3216    [1/6]    │
├────────────────────────────┤
│ Item: 1002341               │
│ Parafuso M8x20   [Trocar]   │
│ Quantidade:  [ - ]  [ 4 ] [+]│
│ Reposição?   (•) Sim ( ) Não │
│ Saldo após: 40 → 36          │
│ ── Resumo ──                  │
│ Matrícula (confirmação): [___]│
│           [ ✓ Confirmar ]    │
└────────────────────────────┘
    ✔ baixa registrada + evento goldbox + fila se offline
```

---

## 10.4 Conferência

```
┌────────────────────────────┐
│ Conferência Dep 3216  [p:0/23]│
│ [🔍 código/descrição]        │
│ Filtros: [Pend] [Divg] [OK]  │
├────────────────────────────┤
│ 1009987 Filtro óleo          │
│  Sistema: 10  Física: [ 7 ]  │
│  Dif: -3  ⚠ DIVERGENTE       │
│  Últ.baixa: 05/08 (-1) Rep:✓ │
│  (toque longo abre correção)  │
└────────────────────────────┘
Modal (toque longo):
│ Quantidade disponível peças: 2 │
│ Tratamento: (•)Usar peça avulsa │
│  ( )Aguardar reposição  ...     │
│ Observação: [________________]  │
│ Matrícula: [____]  [ Confirmar ]│
```

---

## 10.5 Peças avulsas + sugestão

```
┌────────────────────────────┐
│ Peças avulsas  Dep 3216    │
│ [Busca...] [Filter origem] │
│ 5000123  Parafuso M6  qtd 5 │
│   entrada 01/08 · Backlog   │
├────────────────────────────┤
│ ⚠ Sugestão de conversão     │
│ SAP 5000123 → estará na     │
│ nova lista oficial (v4)     │
│ Disponível: 5  Previsto: 3  │
│ Sugerido conversão: [ 3 ]   │
│  [ ✔ Aceitar ][ ✖ Recusar ] │
│  Motivo (se recusa): [_____] │
└────────────────────────────┘
```

---

## 10.6 Consumíveis / EPI (solicitação)

```
┌────────────────────────────┐
│ Consumíveis  Dep 3216      │
│ [Escolher itens p/ solicitar] │
│ ✓ Luvas descartáveis  qtd[40]│
│   Adesivo isolante  qtd[2]  │
├────────────────────────────┤
│ ✏ Editar   ⧉ Copiar  ⇗ Share │
└────────────────────────────┘
Markdown gerado e copiável (navigator.share quando disponível).
```

---

## 10.7 Logs (calendário)

```
┌────────────────────────────┐
│ Logs  Dep 3216   [Calendário]│
│   Set 2026                    │
│  D S T Q Q S S                │
│  1 2 3 4 5 ● 7                │
│  ...● = eventos               │
├────────────────────────────┤
│ 12/08 09:04 BAIXA      🟠    │
│ 12/08 08:55 REPOSICAO  🟢    │
│ 11/08 16:20 CONFERENCIA ⚪    │
│ 10/08 10:01 DIVERGENCIA 🔴    │
* legenda: 🟠peça avulsa 🟢reposição
  🔵liderança 🔴divergência ⚪conferência
```

---

## 10.8 OCR — revisão de importação

```
┌────────────────────────────┐
│ Revisão da folha (v. da foto)│
│ Mat.  | Texto breve | Dep  │
│ 1002341 [Parafuso M8x20] 🟩  │
│         [40] 🟩  | 3216 🟩   │
│ 1033998 [Filtro??]   🟨      │
│         [ ] 🟥 qtd ausente   │
│ 5000123 [novo item]   🟦      │
│ ── Comparação vs v3 ──        │
│ ➕ Novos: 1   ➖ Removidos: 0  │
│ 🔁 Qtd alt: 2   Duplic.: 0    │
│ Matrícula: [____]             │
│ [ 📄 Publicar nova versão ]   │
└────────────────────────────┘
```

---

## 10.9 Sync modal

```
┌─────── Sincronizar agora ───────┐
│ ● Verificando conexão           │
│ ▸ Enviando baixas (3)           │
│ ▸ Enviando conferências (1)     │
│   Enviando correções...  ✔ 38%   │
│   Baixando atualizações...      │
│   Recalculando saldos           │
│   Verificando conflitos         │
│ [Fechar]  (erros: listados)     │
└────────────────────────────────┘
```

---

## 10.10 Login

```
┌────────────────────────────┐
│        LOGENXOVAL           │
│  Matrícula [____________]   │
│  Senha     [____________]   │
│  [ Entrar ]                 │
│  Status: ● online           │
│  Aviso: autenticação offline│
│  limitada a este dispositivo│
└────────────────────────────┘
```

Especificação visual resumida: botões ≥ 48px, alto contraste (fundo claro/escuro de alto contraste), feedback por cores (✔ verde, ⚠ amarelo, ✖ vermelho, 𝘪 novo azul), fontes ≥ 16px em campos de contagem, header fixo com usuário/matrícula/depósito/status.