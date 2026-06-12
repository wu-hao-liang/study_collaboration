import { FormEvent, useEffect, useRef, useState } from "react";

import { searchProducts } from "../../api/http";
import type {
  AnimationName,
  ControlCommand,
  ControlController,
  ProductSummary,
  SpeechTarget
} from "../../api/types";

export function MobileControl({ model }: { model: ControlController }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSummary[]>(model.products);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const holdingSpeechRef = useRef(false);
  const state = model.state;
  const selected =
    model.products.find((product) => product.id === state?.selected_product_id) ?? null;

  useEffect(() => {
    if (!query.trim()) {
      setResults(model.products);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchProducts(query, controller.signal)
        .then(setResults)
        .catch(() => {
          if (!controller.signal.aborted) {
            setLocalError("产品搜索失败");
          }
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [model.products, query]);

  useEffect(() => setPrice(""), [selected?.id]);

  useEffect(() => {
    const stopForBlur = () => {
      if (holdingSpeechRef.current) {
        holdingSpeechRef.current = false;
        void model.sendCommand({ command: "speech_stopped", payload: {} });
      }
    };
    window.addEventListener("blur", stopForBlur);
    document.addEventListener("visibilitychange", stopForBlur);
    return () => {
      window.removeEventListener("blur", stopForBlur);
      document.removeEventListener("visibilitychange", stopForBlur);
    };
  }, [model]);

  const execute = async (key: string, command: ControlCommand) => {
    setBusy(key);
    setLocalError(null);
    try {
      const ack = await model.sendCommand(command);
      if (!ack.ok) {
        setLocalError(ack.error?.message ?? "操作失败");
      }
    } catch {
      setLocalError("控制连接尚未就绪");
    } finally {
      setBusy(null);
    }
  };

  const submitPrice = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !price.trim()) {
      return;
    }
    void execute("price", {
      command: "set_price",
      payload: { product_id: selected.id, raw_value: price }
    });
  };

  if (model.access === "validating") {
    return <MobileMessage title="正在连接场次" detail="请保持手机与电脑连接同一 Wi-Fi。" />;
  }
  if (model.access === "invalid") {
    return <MobileMessage title="配对链接已失效" detail="请在电脑工作台重新生成二维码。" />;
  }
  if (model.access === "occupied") {
    return <MobileMessage title="控制端已被占用" detail="本场只允许一部手机进行控制。" />;
  }

  return (
    <main className="mobileControl">
      <header className="mobileHeader">
        <div>
          <p className="sectionEyebrow">LIVE REMOTE</p>
          <h1>冰箱咨询控制台</h1>
        </div>
        <span className={`mobileConnection connection-${model.connection}`}>
          <span className="statusDot" />
          {model.connection === "connected" ? "已连接" : "恢复中"}
        </span>
      </header>

      {model.error || localError ? (
        <div className="mobileAlert" role="status">
          {localError ?? model.error}
        </div>
      ) : null}

      <section className="mobileCurrent" aria-label="当前直播产品">
        <span>当前直播</span>
        <strong>{selected?.name ?? "尚未选择产品"}</strong>
        <small>{selected?.model ?? "从下方目录选择"}</small>
      </section>

      <section className="mobileSection" aria-labelledby="mobile-search-heading">
        <div className="sectionHeading">
          <h2 id="mobile-search-heading">选择产品</h2>
          <span>{results.length} 项</span>
        </div>
        <label className="mobileField">
          <span>搜索名称、型号或类型</span>
          <input
            type="search"
            placeholder="例如：法式多门"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="mobileProducts" aria-label="手机产品搜索结果">
          {results.map((product) => (
            <button
              type="button"
              key={product.id}
              aria-pressed={product.id === selected?.id}
              disabled={busy !== null || model.connection !== "connected"}
              onClick={() =>
                void execute(`select-${product.id}`, {
                  command: "select_product",
                  payload: { product_id: product.id }
                })
              }
            >
              <span>
                <strong>{product.name}</strong>
                <small>{product.category}</small>
              </span>
              <code>{product.model}</code>
            </button>
          ))}
        </div>
      </section>

      <section className="mobileSection" aria-labelledby="mobile-price-heading">
        <div className="sectionHeading">
          <h2 id="mobile-price-heading">直播价格</h2>
          <span>{selected?.model ?? "未选择"}</span>
        </div>
        <form className="mobilePriceForm" onSubmit={submitPrice}>
          <label className="mobileField">
            <span>人民币金额</span>
            <input
              inputMode="decimal"
              placeholder="输入价格"
              value={price}
              disabled={!selected}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!selected || !price.trim() || busy !== null}>
            更新
          </button>
        </form>
      </section>

      <section className="mobileSection" aria-labelledby="mobile-display-heading">
        <div className="sectionHeading">
          <h2 id="mobile-display-heading">画面控制</h2>
          <span>{state?.active_panel === "details" ? "参数详情" : "产品摘要"}</span>
        </div>
        <div className="mobileSegment" aria-label="手机展示面板">
          <CommandButton
            label="产品摘要"
            pressed={state?.active_panel === "summary"}
            disabled={busy !== null}
            command={{ command: "set_panel", payload: { panel: "summary" } }}
            execute={execute}
          />
          <CommandButton
            label="参数详情"
            pressed={state?.active_panel === "details"}
            disabled={busy !== null}
            command={{ command: "set_panel", payload: { panel: "details" } }}
            execute={execute}
          />
        </div>
        <div className="mobileCommandGrid">
          <AnimationButton
            label="价格高亮"
            name="price_highlight"
            disabled={!selected || busy !== null}
            execute={execute}
          />
          <AnimationButton
            label="产品聚焦"
            name="product_spotlight"
            disabled={!selected || busy !== null}
            execute={execute}
          />
        </div>
        <label className="mobileToggle">
          <span>
            <strong>手势控制</strong>
            <small>允许摄像头滑动切换面板</small>
          </span>
          <input
            type="checkbox"
            checked={state?.gesture.enabled ?? false}
            disabled={busy !== null}
            onChange={(event) =>
              void execute("gesture", {
                command: "set_gesture_enabled",
                payload: { enabled: event.target.checked }
              })
            }
          />
        </label>
      </section>

      <section className="mobileSection" aria-labelledby="mobile-speech-heading">
        <div className="sectionHeading">
          <h2 id="mobile-speech-heading">语音输入目标</h2>
          <span>{state?.speech.target === "price" ? "价格" : "搜索"}</span>
        </div>
        <div className="mobileSegment" aria-label="语音输入目标">
          {(["search", "price"] as SpeechTarget[]).map((target) => (
            <CommandButton
              key={target}
              label={target === "search" ? "产品搜索" : "直播价格"}
              pressed={state?.speech.target === target}
              disabled={busy !== null}
              command={{ command: "speech_set_target", payload: { target } }}
              execute={execute}
            />
          ))}
        </div>
        <button
          type="button"
          className="holdToTalk"
          disabled={model.speechCapability !== "ready" || busy !== null}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            holdingSpeechRef.current = true;
            void execute("speech-start", {
              command: "speech_started",
              payload: {}
            });
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            if (holdingSpeechRef.current) {
              holdingSpeechRef.current = false;
              void execute("speech-stop", {
                command: "speech_stopped",
                payload: {}
              });
            }
          }}
          onPointerCancel={() => {
            if (holdingSpeechRef.current) {
              holdingSpeechRef.current = false;
              void execute("speech-cancel-stop", {
                command: "speech_stopped",
                payload: {}
              });
            }
          }}
        >
          {state?.speech.phase === "listening" ? "松开完成" : "按住说话"}
        </button>
        <p className="mobileNote">
          {model.speechCapability === "ready"
            ? "按住时由电脑麦克风识别，松开后有三秒确认时间。"
            : "请先在电脑工作台初始化语音；手动输入始终可用。"}
        </p>
      </section>
    </main>
  );
}

function MobileMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mobileMessage">
      <p className="sectionEyebrow">LIVE REMOTE</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}

function CommandButton({
  label,
  pressed,
  disabled,
  command,
  execute
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  command: ControlCommand;
  execute: (key: string, command: ControlCommand) => Promise<void>;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => void execute(label, command)}
    >
      {label}
    </button>
  );
}

function AnimationButton({
  label,
  name,
  disabled,
  execute
}: {
  label: string;
  name: AnimationName;
  disabled: boolean;
  execute: (key: string, command: ControlCommand) => Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        void execute(name, {
          command: "trigger_animation",
          payload: { name }
        })
      }
    >
      {label}
    </button>
  );
}
