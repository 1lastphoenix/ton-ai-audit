import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3002);
const TON_LSP_COMMAND = process.env.TON_LSP_COMMAND || "node";
const TON_LSP_ARGS = (process.env.TON_LSP_ARGS || "/opt/ton-language-server/dist/server.js --stdio")
  .split(" ")
  .filter(Boolean);
const REQUIRED_WASM_ASSETS = [
  "tree-sitter.wasm",
  "tree-sitter-tolk.wasm",
  "tree-sitter-func.wasm",
  "tree-sitter-fift.wasm",
  "tree-sitter-tlb.wasm"
];

function resolveTonLspRoot() {
  const entry = TON_LSP_ARGS.find((arg) => arg.endsWith(".js"));
  if (!entry) {
    return "/opt/ton-language-server";
  }

  return dirname(dirname(entry));
}

const TON_LSP_ROOT = resolveTonLspRoot();

function findAssetPath(assetFile) {
  const wasmPath = `${TON_LSP_ROOT}/wasm/${assetFile}`;
  if (existsSync(wasmPath)) {
    return wasmPath;
  }

  const distPath = `${TON_LSP_ROOT}/dist/${assetFile}`;
  if (existsSync(distPath)) {
    return distPath;
  }

  return null;
}

function getLspAssetStatus() {
  const resolvedAssets = REQUIRED_WASM_ASSETS.map((assetFile) => ({
    assetFile,
    path: findAssetPath(assetFile)
  }));
  const missingAssets = resolvedAssets
    .filter((asset) => !asset.path)
    .map((asset) => asset.assetFile);

  return {
    assetsReady: missingAssets.length === 0,
    missingAssets
  };
}

function frameLspMessage(payload) {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

function createLspParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length > 0) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const header = buffer.slice(0, separator).toString("utf8");
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!contentLengthMatch) {
        buffer = buffer.slice(separator + 4);
        continue;
      }

      const contentLength = Number(contentLengthMatch[1]);
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) {
        return;
      }

      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      onMessage(body);
    }
  };
}

function startLanguageServer() {
  return spawn(TON_LSP_COMMAND, TON_LSP_ARGS, {
    cwd: TON_LSP_ROOT,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    const lspAssetStatus = getLspAssetStatus();

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        assetsReady: lspAssetStatus.assetsReady,
        missingAssets: lspAssetStatus.missingAssets,
        tonLspCommand: TON_LSP_COMMAND,
        tonLspArgs: TON_LSP_ARGS,
        tonLspRoot: TON_LSP_ROOT
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server: httpServer, path: "/" });

wss.on("connection", (ws) => {
  const lspAssetStatus = getLspAssetStatus();
  if (!lspAssetStatus.assetsReady) {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          method: "window/showMessage",
          params: {
            type: 1,
            message: `TON LSP assets missing: ${lspAssetStatus.missingAssets.join(", ")}`
          }
        })
      );
      ws.close(1011, "TON LSP assets missing");
    }
    return;
  }

  const lsp = startLanguageServer();
  const parseStdout = createLspParser((message) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });

  lsp.stdout.on("data", parseStdout);
  lsp.stderr.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          method: "window/logMessage",
          params: {
            type: 2,
            message: String(chunk)
          }
        })
      );
    }
  });

  lsp.on("close", () => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const payload = String(data);
    lsp.stdin.write(frameLspMessage(payload));
  });

  ws.on("close", () => {
    if (!lsp.killed) {
      lsp.kill("SIGTERM");
    }
  });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ton-lsp-bridge listening on :${PORT}`);
});
