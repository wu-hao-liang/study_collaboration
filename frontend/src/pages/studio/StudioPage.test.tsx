import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { SessionState, StudioController } from "../../api/types";
import { StudioView } from "../../App";


const state: SessionState = {
  schema_version: 1,
  session_id: "session-1",
  selected_product_id: null,
  active_panel: "summary",
  prices: {},
  gesture: {
    enabled: false,
    last_accepted_at: null
  },
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

const model: StudioController = {
  products: [
    {
      id: "fridge-haier-500",
      category: "十字对开门",
      name: "海尔 500L 十字对开门冰箱",
      model: "BCD-500W",
      image: "/assets/products/fridge-haier-500.svg"
    }
  ],
  productDetails: null,
  state,
  animation: null,
  connection: "connected",
  error: "私有连接错误详情",
  sendCommand: vi.fn()
};


describe("StudioView privacy boundary", () => {
  it("renders capture and private console as sibling regions", () => {
    const { container } = render(<StudioView model={model} />);
    const liveCanvas = container.querySelector("[data-live-canvas]");
    const privateConsole = container.querySelector("[data-private-console]");

    expect(liveCanvas).not.toBeNull();
    expect(privateConsole).not.toBeNull();
    expect(liveCanvas?.closest(".captureColumn")?.parentElement).toBe(
      privateConsole?.parentElement
    );
  });

  it("never renders private errors, search, or device status in the live canvas", () => {
    const { container } = render(<StudioView model={model} />);
    const liveCanvas = container.querySelector("[data-live-canvas]") as HTMLElement;
    const privateConsole = container.querySelector("[data-private-console]") as HTMLElement;

    expect(within(privateConsole).getByText("私有连接错误详情")).toBeInTheDocument();
    expect(within(privateConsole).getAllByText("手机控制")).toHaveLength(2);
    expect(within(liveCanvas).queryByText("私有连接错误详情")).not.toBeInTheDocument();
    expect(within(liveCanvas).queryByText("搜索名称、型号或类型")).not.toBeInTheDocument();
    expect(within(liveCanvas).queryByText("手机控制")).not.toBeInTheDocument();
  });

  it("shows only public product information when a product is selected", () => {
    render(
      <StudioView
        model={{
          ...model,
          error: null,
          state: {
            ...state,
            selected_product_id: "fridge-haier-500",
            prices: { "fridge-haier-500": 399_900 }
          }
        }}
      />
    );

    const liveCanvas = screen.getByRole("heading", {
      name: "海尔 500L 十字对开门冰箱"
    }).closest("[data-live-canvas]") as HTMLElement;
    const summary = liveCanvas.querySelector('[data-panel="summary"]') as HTMLElement;
    expect(within(summary).getByText("BCD-500W")).toBeInTheDocument();
    expect(within(summary).getByText("¥3,999.00")).toBeInTheDocument();
  });
});
