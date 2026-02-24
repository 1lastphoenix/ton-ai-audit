"use client";

import type * as Monaco from "monaco-editor";

const TON_LANGUAGE_IDS = ["tact", "tolk", "func", "fift", "tl-b"] as const;
const TOLK_KEYWORDS = [
  "fun",
  "let",
  "var",
  "if",
  "else",
  "while",
  "for",
  "return",
  "struct",
  "contract",
  "asm",
  "inline",
  "const",
  "import",
  "match",
  "case",
  "break",
  "continue"
] as const;

let monacoVscodeApiInitPromise: Promise<void> | null = null;
let tolkSyntaxRegistered = false;

export type TonLspStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

async function ensureMonacoVscodeApiReady() {
  if (!monacoVscodeApiInitPromise) {
    monacoVscodeApiInitPromise = (async () => {
      const { MonacoVscodeApiWrapper } = await import("monaco-languageclient/vscodeApiWrapper");
      const wrapper = new MonacoVscodeApiWrapper({
        $type: "classic",
        viewsConfig: {
          $type: "EditorService"
        },
        logLevel: 0,
        advanced: {
          enforceSemanticHighlighting: true
        }
      });

      await wrapper.start({
        caller: "ton-lsp-client",
        performServiceConsistencyChecks: false
      });
    })();
  }

  return monacoVscodeApiInitPromise;
}

export function registerTonLanguages(monaco: typeof Monaco) {
  for (const id of TON_LANGUAGE_IDS) {
    if (!monaco.languages.getLanguages().some((language) => language.id === id)) {
      monaco.languages.register({ id });
    }
  }

  if (!tolkSyntaxRegistered) {
    monaco.languages.setLanguageConfiguration("tolk", {
      comments: {
        lineComment: "//",
        blockComment: ["/*", "*/"]
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"]
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "\"", close: "\"" },
        { open: "'", close: "'" }
      ]
    });

    monaco.languages.setMonarchTokensProvider("tolk", {
      tokenizer: {
        root: [
          [/[a-zA-Z_]\w*/, {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier"
            }
          }],
          [/\d+/, "number"],
          [/\/\*/, "comment", "@comment"],
          [/\/\/.*$/, "comment"],
          [/".*?"/, "string"],
          [/'[^']*'/, "string"],
          [/[{}()\[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"],
          [/[+\-*/%=&|!<>:^~?]+/, "operator"]
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\/\*/, "comment", "@push"],
          ["\\*/", "comment", "@pop"],
          [/[/*]/, "comment"]
        ]
      },
      keywords: [...TOLK_KEYWORDS]
    });

    tolkSyntaxRegistered = true;
  }
}

export function startTonLspClient(params: {
  wsUrl?: string;
  wsUrls?: string[];
  onStatus: (status: TonLspStatus) => void;
  onError?: (message: string) => void;
}) {
  type TonLanguageClient = {
    isRunning?: () => boolean;
    start: () => Promise<void>;
    stop: (timeout?: number) => Promise<void>;
  };

  let webSocket: WebSocket | null = null;
  let languageClient: TonLanguageClient | null = null;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  const wsCandidates = (
    params.wsUrls?.length ? params.wsUrls : [params.wsUrl ?? "ws://localhost:3002"]
  )
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  let wsCandidateIndex = 0;

  const currentWsUrl = () => wsCandidates[wsCandidateIndex] ?? "ws://localhost:3002";
  const rotateWsCandidate = () => {
    if (wsCandidates.length <= 1) {
      return;
    }

    wsCandidateIndex = (wsCandidateIndex + 1) % wsCandidates.length;
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  params.onStatus("connecting");

  const setStatus = (status: TonLspStatus) => {
    if (disposed) {
      return;
    }
    params.onStatus(status);
  };

  const reportError = (message: string, error?: unknown) => {
    if (disposed) {
      return;
    }

    params.onError?.(message);
    if (error) {
      console.warn("[ton-lsp-client]", message, error);
    }
    setStatus("error");
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) {
      return;
    }

    reconnectAttempt += 1;
    const backoffMs = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt - 1, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) {
        return;
      }
      setStatus("connecting");
      connect();
    }, backoffMs);
  };

  const stopClient = async () => {
    if (languageClient) {
      const client = languageClient;
      languageClient = null;

      try {
        if (typeof client.isRunning === "function" && !client.isRunning()) {
          return;
        }
        await client.stop();
      } catch {
        // Ignore shutdown races.
      }
    }
  };

  const connect = () => {
    const wsUrl = currentWsUrl();
    const socket = new WebSocket(wsUrl);
    webSocket = socket;
    let opened = false;

    socket.addEventListener("open", () => {
      opened = true;
      clearReconnectTimer();
      reconnectAttempt = 0;

    void (async () => {
      if (disposed) {
        return;
      }

      try {
        await ensureMonacoVscodeApiReady();
        if (disposed) {
          return;
        }

        const [{ MonacoLanguageClient }, { CloseAction, ErrorAction }, wsJsonRpc] = await Promise.all([
          import("monaco-languageclient"),
          import("vscode-languageclient/browser.js"),
          import("vscode-ws-jsonrpc")
        ]);
        if (disposed) {
          return;
        }

        const { toSocket, WebSocketMessageReader, WebSocketMessageWriter } = wsJsonRpc;
        const lspSocket = toSocket(socket);
        const reader = new WebSocketMessageReader(lspSocket);
        const writer = new WebSocketMessageWriter(lspSocket);

        const client = new MonacoLanguageClient({
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
        }) as TonLanguageClient;
        const originalStop = client.stop.bind(client);
        client.stop = async (timeout?: number) => {
          if (typeof client.isRunning === "function" && !client.isRunning()) {
            return;
          }

          try {
            await originalStop(timeout);
          } catch {
            // Suppress stop races when initialization never reached the running state.
          }
        };
        languageClient = client;

        reader.onClose(async () => {
          await stopClient();
          if (!disposed) {
            params.onStatus("disconnected");
            scheduleReconnect();
          }
        });

        await client.start();
        setStatus("connected");
      } catch (error) {
        reportError("Failed to initialize TON LSP client.", error);
        await stopClient();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
        scheduleReconnect();
      }
    })();
    });

    socket.addEventListener("error", (event) => {
      if (!opened) {
        rotateWsCandidate();
      }
      reportError(`TON LSP WebSocket connection error (${wsUrl}).`, event);
    });

    socket.addEventListener("close", async () => {
      await stopClient();
      if (!disposed) {
        if (!opened) {
          rotateWsCandidate();
        }
        params.onStatus("disconnected");
        scheduleReconnect();
      }
    });
  };

  connect();

  return {
    dispose: async () => {
      disposed = true;
      clearReconnectTimer();
      await stopClient();
      if (
        webSocket &&
        (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING)
      ) {
        webSocket.close();
      }
      params.onStatus("disconnected");
    }
  };
}
