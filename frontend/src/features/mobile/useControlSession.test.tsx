import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapResponse, SessionState } from "../../api/types";
import { useControlSession } from "./useControlSession";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;
  private listeners = new Map<string, Set<(event: MessageEvent | Event) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event: MessageEvent | Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const state: SessionState = {
  schema_version: 1,
  session_id: "session-1",
  selected_product_id: null,
  active_panel: "summary",
  prices: {},
  gesture: { enabled: false, last_accepted_at: null },
  speech: {
    phase: "idle",
    target: "search",
    draft: "",
    deadline: null,
    error_code: null
  },
  revision: 0,
  started_at: "2026-06-11T00:00:00Z",
  updated_at: "2026-06-11T00:00:00Z"
};

const bootstrap: BootstrapResponse = {
  config: { ws_studio: "/ws/studio", ws_control: "/ws/control" },
  products: [],
  state
};

function Probe({ token }: { token: string }) {
  const model = useControlSession(token);
  return <pre data-testid="model">{JSON.stringify(model)}</pre>;
}

describe("useControlSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            String(input).includes("/api/control/validate")
              ? { valid: true, slot: "available" }
              : bootstrap
        })
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects with a stable client id and reports an occupied slot", async () => {
    render(<Probe token="secret-token" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/ws/control?");
    expect(socket.url).toContain("token=secret-token");
    expect(socket.url).toContain("client_id=");

    act(() => {
      socket.emit("open", new Event("open"));
      socket.emit(
        "close",
        new CloseEvent("close", { code: 4009, reason: "CONTROL_SLOT_OCCUPIED" })
      );
    });

    expect(screen.getByTestId("model")).toHaveTextContent('"access":"occupied"');
    expect(screen.getByTestId("model")).not.toHaveTextContent("secret-token");
  });
});
