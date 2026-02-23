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
  const webSocket = new WebSocket(params.wsUrl);
  let languageClient: { start: () => void; stop: () => Promise<void> } | null = null;
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
    void (async () => {
      if (disposed) {
        return;
      }

      try {
        await ensureMonacoVscodeApiReady();
      } catch {
        params.onStatus("error");
        webSocket.close();
        return;
      }

      const [{ MonacoLanguageClient }, { CloseAction, ErrorAction }, wsJsonRpc] = await Promise.all([
        import("monaco-languageclient"),
        import("vscode-languageclient/browser.js"),
        import("vscode-ws-jsonrpc")
      ]);

      const { toSocket, WebSocketMessageReader, WebSocketMessageWriter } = wsJsonRpc;
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
    })();
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
