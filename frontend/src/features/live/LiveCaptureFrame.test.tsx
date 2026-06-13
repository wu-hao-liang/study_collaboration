import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  AnimationEvent,
  ProductDetails,
  SessionState
} from "../../api/types";
import { LiveCaptureFrame } from "../../components/LiveCaptureFrame";
import { formatPrice } from "./formatPrice";


const product: ProductDetails = {
  id: "fridge-haier-500",
  category: "十字对开门",
  name: "海尔 500L 十字对开门冰箱",
  model: "BCD-500W",
  image: "/assets/products/fridge-haier-500.svg",
  specs: Array.from({ length: 10 }, (_, index) => ({
    label: `参数 ${index + 1}`,
    value: `值 ${index + 1}`
  }))
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
  revision: 1,
  started_at: "2026-06-11T00:00:00Z",
  updated_at: "2026-06-11T00:00:00Z"
};

const animation: AnimationEvent = {
  type: "animation",
  event_id: "event-1",
  name: "price_highlight",
  product_id: product.id,
  issued_at: "2026-06-11T00:00:00Z"
};


describe("LiveCaptureFrame", () => {
  it("formats RMB and preserves the pending price label", () => {
    expect(formatPrice(null)).toBe("价格待定");
    expect(formatPrice(399_900)).toBe("¥3,999.00");
  });

  it("keeps both panels mounted while only summary is audience-visible", () => {
    const { container } = render(
      <LiveCaptureFrame
        product={product}
        details={product}
        state={state}
        animation={null}
      />
    );
    const summary = container.querySelector('[data-panel="summary"]') as HTMLElement;
    const details = container.querySelector('[data-panel="details"]') as HTMLElement;
    const canvas = container.querySelector("[data-live-canvas]");

    expect(canvas).toHaveAttribute("data-output-width", "720");
    expect(canvas).toHaveAttribute("data-output-height", "1280");
    expect(within(container).getByText("720 × 1280")).toBeInTheDocument();
    expect(summary).toHaveAttribute("aria-hidden", "false");
    expect(details).toHaveAttribute("aria-hidden", "true");
    expect(within(summary).getByText("价格待定")).toBeInTheDocument();
  });

  it("preserves details panel while the selected product changes", () => {
    const { container, rerender } = render(
      <LiveCaptureFrame
        product={product}
        details={product}
        state={{ ...state, active_panel: "details" }}
        animation={null}
      />
    );
    const otherProduct = {
      ...product,
      id: "fridge-midea-508",
      name: "美的 508L 双系统冰箱",
      model: "BCD-508WTPZM"
    };
    rerender(
      <LiveCaptureFrame
        product={otherProduct}
        details={otherProduct}
        state={{
          ...state,
          selected_product_id: otherProduct.id,
          active_panel: "details"
        }}
        animation={null}
      />
    );

    const details = container.querySelector('[data-panel="details"]') as HTMLElement;
    const summary = container.querySelector('[data-panel="summary"]') as HTMLElement;
    expect(details).toHaveAttribute("aria-hidden", "false");
    expect(summary).toHaveAttribute("aria-hidden", "true");
    expect(within(details).getByText("美的 508L 双系统冰箱")).toBeInTheDocument();
  });

  it("limits details to eight ordered specs and restarts animation by event id", () => {
    const { container, rerender } = render(
      <LiveCaptureFrame
        product={product}
        details={product}
        state={{ ...state, active_panel: "details" }}
        animation={animation}
      />
    );

    const details = container.querySelector('[data-panel="details"]') as HTMLElement;
    expect(within(details).getByText("参数 1")).toBeInTheDocument();
    expect(within(details).getByText("参数 8")).toBeInTheDocument();
    expect(within(details).queryByText("参数 9")).not.toBeInTheDocument();
    const firstAnimatedNode = container.querySelector(".livePanels");
    expect(firstAnimatedNode).toHaveClass("animation-price_highlight");

    rerender(
      <LiveCaptureFrame
        product={product}
        details={product}
        state={{ ...state, active_panel: "details" }}
        animation={{ ...animation, event_id: "event-2" }}
      />
    );
    expect(container.querySelector(".livePanels")).not.toBe(firstAnimatedNode);
  });
});
