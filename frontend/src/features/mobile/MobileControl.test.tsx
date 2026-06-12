import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ControlCommand,
  ControlController,
  ProductSummary,
  SessionState
} from "../../api/types";
import { MobileControl } from "./MobileControl";

const product: ProductSummary = {
  id: "fridge-haier-500",
  category: "十字对开门",
  name: "海尔 500L 十字对开门冰箱",
  model: "BCD-500W",
  image: "/assets/products/fridge-haier-500.svg"
};

const state: SessionState = {
  schema_version: 1,
  session_id: "session-1",
  selected_product_id: product.id,
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
  revision: 3,
  started_at: "2026-06-11T00:00:00Z",
  updated_at: "2026-06-11T00:00:00Z"
};

function controller(sendCommand = vi.fn()): ControlController {
  sendCommand.mockResolvedValue({
    type: "ack",
    request_id: "request-1",
    ok: true,
    revision: 4,
    error: null
  });
  return {
    products: [product],
    productDetails: null,
    state,
    animation: null,
    connection: "connected",
    error: null,
    access: "ready",
    sendCommand
  };
}

describe("MobileControl", () => {
  it("shows clear invalid and occupied states", () => {
    const { rerender } = render(
      <MobileControl model={{ ...controller(), access: "invalid" }} />
    );
    expect(screen.getByRole("heading", { name: "配对链接已失效" })).toBeInTheDocument();

    rerender(<MobileControl model={{ ...controller(), access: "occupied" }} />);
    expect(screen.getByRole("heading", { name: "控制端已被占用" })).toBeInTheDocument();
  });

  it("sends all allowed mobile commands and never exposes end session", async () => {
    const sendCommand = vi.fn();
    render(<MobileControl model={controller(sendCommand)} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "海尔 500L 十字对开门冰箱 十字对开门 BCD-500W" }));
    await user.type(screen.getByLabelText("人民币金额"), "3999");
    await user.click(screen.getByRole("button", { name: "更新" }));
    await user.click(screen.getByRole("button", { name: "参数详情" }));
    await user.click(screen.getByRole("button", { name: "价格高亮" }));
    await user.click(screen.getByRole("button", { name: "产品聚焦" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "手势控制 允许摄像头滑动切换面板" }));
    await user.click(screen.getByRole("button", { name: "直播价格" }));

    const commands = sendCommand.mock.calls.map(
      (call) => (call[0] as ControlCommand).command
    );
    expect(commands).toEqual([
      "select_product",
      "set_price",
      "set_panel",
      "trigger_animation",
      "trigger_animation",
      "set_gesture_enabled",
      "speech_set_target"
    ]);
    expect(screen.queryByRole("button", { name: /结束场次/ })).not.toBeInTheDocument();
  });

  it("stops speech on pointer cancel", async () => {
    const sendCommand = vi.fn();
    render(
      <MobileControl
        model={{ ...controller(sendCommand), speechCapability: "ready" }}
      />
    );
    const talk = screen.getByRole("button", { name: "按住说话" });

    fireEvent.pointerDown(talk);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    fireEvent.pointerCancel(talk);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));

    expect(sendCommand.mock.calls.map((call) => call[0].command)).toEqual([
      "speech_started",
      "speech_stopped"
    ]);
  });
});
