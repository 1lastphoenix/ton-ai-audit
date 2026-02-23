# Web App (`@ton-audit/web`)

Next.js App Router service for the TON audit platform.

## Responsibilities

- GitHub OAuth login via `better-auth`
- Project/revision/audit API routes
- Codespaces-like Monaco workbench UI
- SSE job progress stream
- PDF export trigger and download URL serving
- Operator dead-letter endpoints for failed queue jobs

## Health Endpoints

- `GET /api/healthz`
- `GET /api/readyz`

## Required Environment

Use root `.env.example` as baseline. The web service expects:

- Postgres / Redis / MinIO connectivity
- GitHub OAuth credentials
- OpenRouter API credentials
- Sandbox runner and LSP URLs

## Run

```bash
pnpm --filter @ton-audit/web dev
```

For production compose, use root `docker-compose.prod.yml`.
