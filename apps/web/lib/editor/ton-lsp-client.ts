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
  wsUrl: string;
  onStatus: (status: TonLspStatus) => void;
}) {
  type TonLanguageClient = {
    isRunning?: () => boolean;
    start: () => Promise<void>;
    stop: (timeout?: number) => Promise<void>;
  };

  const webSocket = new WebSocket(params.wsUrl);
  let languageClient: TonLanguageClient | null = null;
  let disposed = false;
  let hasError = false;

  params.onStatus("connecting");

  const setStatus = (status: TonLspStatus) => {
    if (disposed) {
      return;
    }

    if (status === "error") {
      hasError = true;
    }

    params.onStatus(status);
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

  webSocket.addEventListener("open", () => {
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
        const socket = toSocket(webSocket);
        const reader = new WebSocketMessageReader(socket);
        const writer = new WebSocketMessageWriter(socket);

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
          if (!disposed && !hasError) {
            params.onStatus("disconnected");
          }
        });

        await client.start();
        setStatus("connected");
      } catch {
        setStatus("error");
        await stopClient();
        if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) {
          webSocket.close();
        }
      }
    })();
  });

  webSocket.addEventListener("error", () => {
    setStatus("error");
  });

  webSocket.addEventListener("close", async () => {
    await stopClient();
    if (!disposed && !hasError) {
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
