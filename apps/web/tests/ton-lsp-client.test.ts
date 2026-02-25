import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerTonLanguages, startTonLspClient } from "../lib/editor/ton-lsp-client";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  private listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event?: unknown) => void) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  emit(type: string, event?: unknown) {
    const callbacks = this.listeners.get(type) ?? [];
    for (const callback of callbacks) {
      callback(event);
    }
  }
}

describe("ton lsp client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it("registers TON languages, fallback tolk syntax, and test globals once", () => {
    const registeredIds: string[] = [];
    const addTsExtraLib = vi.fn();
    const addJsExtraLib = vi.fn();

    const monaco = {
      languages: {
        getLanguages: vi.fn(() => registeredIds.map((id) => ({ id }))),
        register: vi.fn(({ id }: { id: string }) => {
          registeredIds.push(id);
        }),
        setLanguageConfiguration: vi.fn(),
        setMonarchTokensProvider: vi.fn(),
        typescript: {
          typescriptDefaults: {
            addExtraLib: addTsExtraLib
          },
          javascriptDefaults: {
            addExtraLib: addJsExtraLib
          }
        }
      }
    };

    registerTonLanguages(monaco as never);
    registerTonLanguages(monaco as never);

    expect(registeredIds).toEqual(["tact", "tolk", "func", "fift", "tl-b"]);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
      "tolk",
      expect.objectContaining({ comments: expect.any(Object) })
    );
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      "tolk",
      expect.objectContaining({ tokenizer: expect.any(Object) })
    );
    expect(addTsExtraLib).toHaveBeenCalledTimes(1);
    expect(addJsExtraLib).toHaveBeenCalledTimes(1);
  });

  it("rotates websocket fallback host only once per failed connection attempt", async () => {
    vi.useFakeTimers();

    const statuses: string[] = [];

    const client = startTonLspClient({
      wsUrls: ["ws://localhost:3002", "ws://127.0.0.1:3002"],
      onStatus: (status) => {
        statuses.push(status);
      }
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("ws://localhost:3002");

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("error", new Error("connect failed"));
    firstSocket.emit("close");

    await vi.advanceTimersByTimeAsync(500);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1]?.url).toBe("ws://127.0.0.1:3002");
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("disconnected");

    await client.dispose();
  });
});