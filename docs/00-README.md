# LogEnxoval — Documentação Técnica

PWA mobile-first e offline-first para controle, baixa, conferência, reposição, auditoria e administração do enxoval de caminhões-oficina.

## Stack decidido

| Camada      | Tecnologia                                  |
| ----------- | ------------------------------------------- |
| PWA         | React 18 + Vite + TypeScript + Dexie (IndexedDB) + Workbox |
| API         | Node.js + Fastify + TypeScript + Zod        |
| Banco local | IndexedDB (Dexie)                           |
| Banco    | PostgreSQL + Flyway (migrations)            |
| OCR         | Tesseract.js local (offline-first)          |
| Relatórios  | jsPDF (PDF) + canvas (PNG) no aparelho      |

## Regra central

`depositoId + codigoSap` é a chave operacional de estoque. O número do depósito é a unidade permanente de pertencimento. Frente de serviço **nunca** é identificador de estoque.

## Documentos (entregáveis da Seção 22)

| #  | Documento                                                   |
| -- | ----------------------------------------------------------- |
| 1  | [01-arquitetura](01-arquitetura.md)                         |
| 2  | [02-modelo-de-dados](02-modelo-de-dados.md)                 |
| 3  | [03-fluxo-autenticacao](03-fluxo-autenticacao.md)           |
| 4  | [04-fluxo-baixa](04-fluxo-baixa.md)                         |
| 5  | [05-fluxo-conferencia](05-fluxo-conferencia.md)             |
| 6  | [06-fluxo-ocr](06-fluxo-ocr.md)                             |
| 7  | [07-sincronizacao](07-sincronizacao.md)                     |
| 8  | [08-conflitos](08-conflitos.md)                             |
| 9  | [09-matriz-permissoes](09-matriz-permissoes.md)             |
| 10 | [10-wireframes](10-wireframes.md)                           |
| 11 | [11-contratos-api](11-contratos-api.md)                     |
| 12 | [12-plano-seguranca](12-plano-seguranca.md)                 |
| 13 | [13-plano-testes](13-plano-testes.md)                       |
| 14 | [14-plano-backup](14-plano-backup.md)                       |
| 15 | [15-plano-restauracao](15-plano-restauracao.md)             |
| 16 | [16-roadmap](16-roadmap.md)                                 |