# TON Audit Platform

Self-hosted TON smart-contract audit platform with:
- Next.js App Router web app + API (`apps/web`)
- BullMQ worker runtime (`apps/worker`)
- Shared Drizzle/Zod contracts (`packages/shared`)
- Dockerized local infra (`infra/docker-compose.yml`)

- `apps/web`: Next.js web app and API.
- `apps/worker`: BullMQ background workers.
- `packages/shared`: shared schemas/types/constants.
- `infra`: self-hosted Docker services.

## Quick start

1. Install dependencies:
   - `pnpm install`
2. Start local infra:
   - `docker compose -f infra/docker-compose.yml up -d`
3. Configure environment:
   - Copy `.env.example` to `.env` and fill OAuth/OpenRouter keys.
4. Generate and run migrations:
   - `pnpm db:generate`
   - `pnpm db:migrate`
5. Start apps:
   - Web: `pnpm dev:web`
   - Worker: `pnpm dev:worker`

## Core capabilities in this scaffold

- GitHub OAuth auth with `better-auth`
- Project creation, upload, immutable revisions, working copies
- Async audit pipeline with BullMQ queues:
  - `ingest -> verify -> audit -> finding-lifecycle`
  - `docs-crawl -> docs-index`
  - `pdf`, `cleanup`
- MinIO object storage integration for source files/artifacts/PDF exports
- Codespaces-like Monaco workbench for read-only audited revisions and re-audit workflow
- Sandbox runner with pinned TON toolchain bootstrap (`infra/sandbox-runner/pinned-toolchain.json`)
- TON language-server WebSocket bridge (`infra/lsp-service`) for Monaco LSP wiring
