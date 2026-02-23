# TON LSP Bridge

WebSocket bridge for `ton-language-server` (stdio) so Monaco can use full LSP diagnostics/completions.

## Endpoints

- `GET /health`
- `WS /` JSON-RPC transport (LSP)

## Env

- `PORT` default: `3002`
- `TON_LSP_COMMAND` default: `node`
- `TON_LSP_ARGS` default: `/opt/ton-language-server/server.js --stdio`

## Notes

- The bridge spawns one language-server process per WebSocket connection.
- Messages are framed/unframed via standard LSP `Content-Length` protocol.
- `Dockerfile` clones `ton-blockchain/ton-language-server` and uses its `server.js` entrypoint.
