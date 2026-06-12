import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AckEvent,
  ProductSummary,
  SessionState,
  StudioCommand,
  StudioController
} from "../../api/types";
import { PrivateConsole } from "../../components/PrivateConsole";


vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr")
  }
}));

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

const ack: AckEvent = {
  type: "ack",
  request_id: "request-1",
  ok: true,
  revision: 4,
  error: null
};

function buildController(sendCommand: (command: StudioCommand) => Promise<AckEvent>) {
  return {
    products: [product],
    productDetails: null,
    state,
    animation: null,
    connection: "connected",
    error: null,
    sendCommand
  } satisfies StudioController;
}


describe("PrivateConsole controls", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends price, panel, animation, gesture, and end-session commands", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async () => ack);
    render(<PrivateConsole model={buildController(sendCommand)} selectedProduct={product} />);

    await user.type(screen.getByPlaceholderText("输入人民币金额"), "3999");
    await user.click(screen.getByRole("button", { name: "更新价格" }));
    await user.click(screen.getByRole("button", { name: "参数详情" }));
    await user.click(screen.getByRole("button", { name: "产品聚焦" }));
    await user.click(screen.getByRole("checkbox", { name: "启用手势控制" }));
    await user.click(screen.getByRole("button", { name: "结束场次" }));
    const dialog = screen.getByRole("dialog", { name: "确认结束当前场次？" });
    await user.click(within(dialog).getByRole("button", { name: "确认结束" }));

    expect(sendCommand).toHaveBeenCalledWith({
      command: "set_price",
      payload: { product_id: product.id, raw_value: "3999" }
    });
    expect(sendCommand).toHaveBeenCalledWith({
      command: "set_panel",
      payload: { panel: "details" }
    });
    expect(sendCommand).toHaveBeenCalledWith({
      command: "trigger_animation",
      payload: { name: "product_spotlight" }
    });
    expect(sendCommand).toHaveBeenCalledWith({
      command: "set_gesture_enabled",
      payload: { enabled: true }
    });
    expect(sendCommand).toHaveBeenCalledWith({
      command: "end_session",
      payload: {}
    });
  });

  it("searches through the backend and selects a result", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async () => ack);
    const searchResult = {
      ...product,
      id: "fridge-ronshen-452",
      name: "容声 452L 法式多门冰箱",
      model: "BCD-452WD16MPA"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ products: [searchResult] })
      })
    );
    render(<PrivateConsole model={buildController(sendCommand)} selectedProduct={product} />);

    await user.type(screen.getByPlaceholderText("例如：法式多门、BCD-500"), "法式");
    const result = await screen.findByText("容声 452L 法式多门冰箱");
    await user.click(result.closest("button") as HTMLButtonElement);

    expect(fetch).toHaveBeenCalledWith(
      "/api/products?q=%E6%B3%95%E5%BC%8F",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(sendCommand).toHaveBeenCalledWith({
      command: "select_product",
      payload: { product_id: searchResult.id }
    });
  });

  it("generates private pairing QR content", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "secret",
          phone_url: "http://192.168.1.10:8000/control/secret"
        })
      })
    );
    render(
      <PrivateConsole
        model={buildController(vi.fn(async () => ack))}
        selectedProduct={product}
      />
    );

    await user.click(screen.getByRole("button", { name: "生成配对二维码" }));

    expect(await screen.findByAltText("手机控制二维码")).toHaveAttribute(
      "src",
      "data:image/png;base64,qr"
    );
    expect(screen.getByText("http://192.168.1.10:8000/control/secret")).toBeInTheDocument();
  });
});
