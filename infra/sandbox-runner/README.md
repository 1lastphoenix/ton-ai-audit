# Sandbox Runner

Isolated execution service for TON verification steps.

## API

- `GET /health`
- `POST /execute`

`POST /execute` accepts:

- `files[]`: `{ path, content }`
- `steps[]`: action-based steps (`bootstrap-create-ton`, `blueprint-build`, `blueprint-test`, `tact-check`, `func-check`, `tolk-check`)
- `metadata`: adapter/bootstrap hints

Free-form shell commands are intentionally not accepted.

Progress streaming:
- Set request header `x-sandbox-stream: 1` to receive line-delimited JSON (`application/x-ndjson`).
- Stream events include `started`, `step-started`, `step-finished`, `completed`, and `error`.

## Security Model

- Unsafe paths rejected (`..`, absolute paths, null bytes)
- Payload/file count/size guards enforced
- Step actions allowlisted
- Per-job ephemeral workspace
- Optional docker step execution mode with `--network none`, CPU/memory/pid limits

## Toolchain Pinning

Pinned versions are defined in `pinned-toolchain.json` and installed in image build.

## Environment

- `PORT` default `3003`
- `SANDBOX_MAX_FILES` default `300`
- `SANDBOX_MAX_TOTAL_BYTES` default `25MB`
- `SANDBOX_MAX_REQUEST_BYTES` default `30MB`
- `SANDBOX_EXECUTION_MODE` `local|docker` (default `docker`)
- `SANDBOX_DOCKER_IMAGE` docker execution image

For docker mode, mount docker socket into the runner container (for example `${DOCKER_SOCK_PATH:-/var/run/docker.sock}:/var/run/docker.sock` in compose).
