# LogEnxoval

PWA mobile-first e offline-first para controle, baixa, conferência, reposição, auditoria e administração do enxoval de caminhões-oficina.

Documentação: [docs/](docs/00-README.md)

## Pré-requisitos

- Node.js ≥ 20
- Docker (PostgreSQL local)

## Início rápido

```bash
docker compose up -d db        # PostgreSQL :5433
npm install
cp apps/server/.env.example apps/server/.env
npm run dev:server             # API em :3000
npm run dev:pwa                # PWA em Vite
```

## Monorepo

| Pacote | Papel |
| ------ | ----- |
| `apps/pwa` | PWA React + Vite + Dexie (Vercel) |
| `apps/server` | API Fastify + PostgreSQL (Vercel serverless/standalone) |
| `packages/contracts` | Tipos + Zod compartilhados |

## Comandos

```bash
npm run typecheck   # todos os pacotes
npm run test        # servidor + pwa
npm run build       # todos os pacotes
```

## Regra de ouro

Toda movimentação de estoque possui depósito, usuário (matrícula), data/hora, quantidade e registro de auditoria.