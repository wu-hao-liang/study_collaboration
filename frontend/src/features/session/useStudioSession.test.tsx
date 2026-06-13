import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapResponse, SessionState } from "../../api/types";
import { useStudioSession } from "./useStudioSession";


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
    this.emit("close", new Event("close"));
  }

  emit(type: string, event: MessageEvent | Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const initialState: SessionState = {
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
  config: {
    ws_studio: "/ws/studio",
    ws_control: "/ws/control"
  },
  products: [],
  state: initialState
};


function Probe() {
  const model = useStudioSession();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void model
            .sendCommand({
              command: "set_panel",
              payload: { panel: "details" }
            })
            .then((ack) => {
              document.body.dataset.ack = String(ack.ok);
            })
        }
      >
        command
      </button>
      <pre data-testid="model">{JSON.stringify(model)}</pre>
    </>
  );
}


describe("useStudioSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => bootstrap
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("replaces state from snapshots, answers ping, and reconnects", async () => {
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = FakeWebSocket.instances[0];
    expect(first).toBeDefined();

    act(() => {
      first.emit("open", new Event("open"));
      first.emit(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({ type: "ping" })
        })
      );
      first.emit(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "state",
            event_id: "event-1",
            revision: 7,
            state: {
              ...initialState,
              revision: 7,
              active_panel: "details",
              prices: { "fridge-haier-500": 399_900 }
            }
          })
        })
      );
      first.emit(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "animation",
            event_id: "animation-1",
            name: "product_spotlight",
            product_id: null,
            issued_at: "2026-06-11T00:00:00Z"
          })
        })
      );
      first.emit(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "animation",
            event_id: "animation-1",
            name: "price_highlight",
            product_id: null,
            issued_at: "2026-06-11T00:00:01Z"
          })
        })
      );
    });

    expect(first.sent).toContain(JSON.stringify({ type: "pong" }));
    expect(screen.getByTestId("model")).toHaveTextContent('"revision":7');
    expect(screen.getByTestId("model")).toHaveTextContent('"active_panel":"details"');
    expect(screen.getByTestId("model")).toHaveTextContent('"name":"product_spotlight"');
    expect(screen.getByTestId("model")).not.toHaveTextContent('"name":"price_highlight"');

    fireEvent.click(screen.getByRole("button", { name: "command" }));
    const command = JSON.parse(first.sent.at(-1) ?? "{}") as {
      request_id: string;
      expected_revision: number;
    };
    expect(command.expected_revision).toBe(7);
    act(() => {
      first.emit(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "ack",
            request_id: command.request_id,
            ok: true,
            revision: 8,
            error: null
          })
        })
      );
    });
    await act(async () => Promise.resolve());
    expect(document.body.dataset.ack).toBe("true");

    act(() => {
      first.emit("close", new Event("close"));
    });
    expect(screen.getByTestId("model")).toHaveTextContent('"connection":"connecting"');
    expect(screen.getByTestId("model")).not.toHaveTextContent("实时连接已断开");

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.instances[1];
    act(() => {
      second.emit("open", new Event("open"));
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId("model")).toHaveTextContent('"connection":"connected"');
    expect(screen.getByTestId("model")).not.toHaveTextContent("实时连接暂时不可用");
  });
});
