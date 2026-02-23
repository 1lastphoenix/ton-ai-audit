"use client";

import type * as Monaco from "monaco-editor";
import { MonacoLanguageClient } from "monaco-languageclient";
import { CloseAction, ErrorAction } from "vscode-languageclient/browser.js";
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from "vscode-ws-jsonrpc";

const TON_LANGUAGE_IDS = ["tact", "tolk", "func", "fift", "tl-b"] as const;

export type TonLspStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export function registerTonLanguages(monaco: typeof Monaco) {
  for (const id of TON_LANGUAGE_IDS) {
    if (!monaco.languages.getLanguages().some((language) => language.id === id)) {
      monaco.languages.register({ id });
    }
  }
}

export function startTonLspClient(params: {
  wsUrl: string;
  onStatus: (status: TonLspStatus) => void;
}) {
  const webSocket = new WebSocket(params.wsUrl);
  let languageClient: MonacoLanguageClient | null = null;
  let disposed = false;

  params.onStatus("connecting");

  const stopClient = async () => {
    if (languageClient) {
      try {
        await languageClient.stop();
      } catch {
        // Ignore shutdown races.
      }
      languageClient = null;
    }
  };

  webSocket.addEventListener("open", () => {
    if (disposed) {
      return;
    }

    const socket = toSocket(webSocket);
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);

    languageClient = new MonacoLanguageClient({
      id: "ton-language-server",
      name: "TON Language Server",
      clientOptions: {
        documentSelector: TON_LANGUAGE_IDS.map((language) => ({ language })),
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart })
        }
      },
      messageTransports: {
        reader,
        writer
      }
    });

    languageClient.start();
    reader.onClose(async () => {
      await stopClient();
      if (!disposed) {
        params.onStatus("disconnected");
      }
    });

    params.onStatus("connected");
  });

  webSocket.addEventListener("error", () => {
    if (!disposed) {
      params.onStatus("error");
    }
  });

  webSocket.addEventListener("close", async () => {
    await stopClient();
    if (!disposed) {
      params.onStatus("disconnected");
    }
  });

  return {
    dispose: async () => {
      disposed = true;
      await stopClient();
      if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) {
        webSocket.close();
      }
      params.onStatus("disconnected");
    }
  };
}
