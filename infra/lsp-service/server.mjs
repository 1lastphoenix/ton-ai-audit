import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3002);
const TON_LSP_COMMAND = process.env.TON_LSP_COMMAND || "node";
const TON_LSP_ARGS = (process.env.TON_LSP_ARGS || "/opt/ton-language-server/server.js --stdio")
  .split(" ")
  .filter(Boolean);

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
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        tonLspCommand: TON_LSP_COMMAND,
        tonLspArgs: TON_LSP_ARGS
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server: httpServer, path: "/" });

wss.on("connection", (ws) => {
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
