<img width="1919" height="908" alt="image" src="https://github.com/user-attachments/assets/e3452245-bbe1-4970-a15b-9c2e2c971e4f" />

# TON Audit Platform

Self-hosted TON smart-contract audit platform with:
- Next.js App Router web app + API (`apps/web`)
- BullMQ worker runtime (`apps/worker`)
- Shared Drizzle/Zod contracts (`packages/shared`)
- Containerized local/dev and production compose stacks (`docker-compose.yml`, `docker-compose.prod.yml`)

- `apps/web`: Next.js web app and API.
- `apps/worker`: BullMQ background workers.
- `packages/shared`: shared schemas/types/constants.
- `infra`: self-hosted Docker services.

## Quick start

1. Copy `.env.example` to `.env` and fill OAuth/OpenRouter keys.
2. Install dependencies: `pnpm install`.
3. Start local dev (infra + migrations + web + worker): `pnpm dev`.
4. Open `http://localhost:3000`.

`pnpm dev` uses a quick bootstrap path:
- validates env and local compose config
- starts/repairs local infra stack if needed
- runs DB migrations (with one recovery retry)
- waits for sandbox/LSP readiness
- launches web + worker dev servers on host

Optional infra-only mode:
- Start infra services only: `docker compose -f docker-compose.yml up -d --build postgres redis minio minio-init sandbox-runner lsp-service`
- Run apps on host: `pnpm dev:web` and `pnpm dev:worker`

One-liner full local verification:
- `pnpm dev:test:all`
- Optional custom env file: `pnpm dev:test:all -- --env-file .env.local`
- This command builds/starts the local stack and leaves services running.
- It checks existing local compose services first and skips `docker compose up` when the stack is already healthy.
- It also validates production container buildability for `apps/web` and `apps/worker`.

## Production deployment

- Start from the production template: `cp .env.production.example .env`
- Use `docker-compose.prod.yml`: `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`
- The production compose file does not publish host ports; all ingress should be handled by Dokploy/Traefik.
- Internal trust-zone services run on `core` internal network.
- Public-facing services join external proxy network `${PROXY_NETWORK:-dokploy-network}`.
- In Dokploy, map domains to container internal ports:
  - `web` -> `3000`
  - `lsp-service` -> `3002` (if Monaco browser LSP is enabled)
- Sandbox runner defaults to docker-isolated execution and requires docker socket access (`DOCKER_SOCK_PATH`).
- If you override sandbox image tags, keep `SANDBOX_RUNNER_IMAGE` and `SANDBOX_DOCKER_IMAGE` aligned.

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
- Health endpoints:
  - Web: `/api/healthz`, `/api/readyz`
  - Worker: `/healthz`, `/readyz`
