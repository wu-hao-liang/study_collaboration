import { FormEvent, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { fetchPairing, searchProducts } from "../api/http";
import type {
  AnimationName,
  ProductSummary,
  StudioController,
  StudioCommand
} from "../api/types";
import { useDesktopSpeech } from "../features/speech/useDesktopSpeech";
import {
  OUTPUT_RESOLUTIONS,
  outputResolutionById,
  type OutputResolution
} from "../features/live/outputResolution";

type PrivateConsoleProps = {
  model: StudioController;
  selectedProduct: ProductSummary | null;
  outputResolution: OutputResolution;
  onOutputResolutionChange: (resolution: OutputResolution) => void;
};

export function PrivateConsole({
  model,
  selectedProduct,
  outputResolution,
  onOutputResolutionChange
}: PrivateConsoleProps) {
  const state = model.state;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSummary[]>(model.products);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ phoneUrl: string; qrDataUrl: string } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [reviewDraft, setReviewDraft] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const previousSpeechRef = useRef(state?.speech);
  const speech = useDesktopSpeech(model);

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

  useEffect(() => {
    setPrice("");
  }, [selectedProduct?.id]);

  useEffect(() => {
    if (state?.speech.phase === "reviewing") {
      setReviewDraft(state.speech.draft);
    }
    const previous = previousSpeechRef.current;
    if (
      previous?.phase === "committing" &&
      previous.target === "search" &&
      state?.speech.phase === "idle"
    ) {
      setQuery(previous.draft);
    }
    previousSpeechRef.current = state?.speech;
  }, [state?.speech]);

  useEffect(() => {
    if (state?.speech.phase !== "reviewing") {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.speech.phase]);

  const connectionLabel = {
    loading: "正在载入",
    connecting: "正在连接",
    connected: "实时连接正常",
    disconnected: "连接已断开"
  }[model.connection];

  const execute = async (key: string, command: StudioCommand) => {
    setBusy(key);
    setLocalError(null);
    try {
      const ack = await model.sendCommand(command);
      if (!ack.ok) {
        setLocalError(ack.error?.message ?? "操作失败");
      }
    } catch {
      setLocalError("实时连接未就绪");
    } finally {
      setBusy(null);
    }
  };

  const submitPrice = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProduct || !price.trim()) {
      return;
    }
    void execute("price", {
      command: "set_price",
      payload: {
        product_id: selectedProduct.id,
        raw_value: price
      }
    });
  };

  const loadPairing = async () => {
    setBusy("pairing");
    setLocalError(null);
    try {
      const response = await fetchPairing();
      const qrDataUrl = await QRCode.toDataURL(response.phone_url, {
        margin: 1,
        width: 220,
        color: {
          dark: "#172026",
          light: "#ffffff"
        }
      });
      setPairing({ phoneUrl: response.phone_url, qrDataUrl });
    } catch {
      setLocalError("无法生成手机配对信息");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="privateConsole" data-private-console aria-label="私有后台">
      <header className="consoleHeader">
        <div>
          <p className="sectionEyebrow">PRIVATE CONSOLE</p>
          <h2>直播工作台</h2>
        </div>
        <div className={`connectionBadge connection-${model.connection}`}>
          <span className="statusDot" />
          {connectionLabel}
        </div>
      </header>

      {model.error || localError ? (
        <div className="privateAlert" role="status">
          {localError ?? model.error}
        </div>
      ) : null}

      <section className="consoleSection" aria-labelledby="session-heading">
        <div className="sectionHeading">
          <h3 id="session-heading">场次状态</h3>
          <span>REV {state?.revision ?? "—"}</span>
        </div>
        <dl className="statusGrid">
          <div>
            <dt>当前产品</dt>
            <dd>{selectedProduct?.name ?? "尚未选择"}</dd>
          </div>
          <div>
            <dt>展示面板</dt>
            <dd>{state?.active_panel === "details" ? "参数详情" : "产品摘要"}</dd>
          </div>
          <div>
            <dt>手势控制</dt>
            <dd>{state?.gesture.enabled ? "已启用" : "未启用"}</dd>
          </div>
          <div>
            <dt>语音状态</dt>
            <dd>{speechLabel(state?.speech.phase)}</dd>
          </div>
        </dl>
        <label className="resolutionField">
          <span>输出分辨率</span>
          <select
            value={outputResolution.id}
            onChange={(event) =>
              onOutputResolutionChange(outputResolutionById(event.target.value))
            }
          >
            {OUTPUT_RESOLUTIONS.map((resolution) => (
              <option key={resolution.id} value={resolution.id}>
                {resolution.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="consoleSection catalogSection" aria-labelledby="catalog-heading">
        <div className="sectionHeading">
          <h3 id="catalog-heading">产品目录</h3>
          <span>{results.length} 项结果</span>
        </div>
        <label className="searchField">
          <span>搜索名称、型号或类型</span>
          <input
            type="search"
            placeholder="例如：法式多门、BCD-500"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="productResults" aria-label="产品搜索结果">
          {results.map((product) => (
            <button
              type="button"
              className={product.id === selectedProduct?.id ? "productResult selected" : "productResult"}
              key={product.id}
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

      <section className="consoleSection" aria-labelledby="product-heading">
        <div className="sectionHeading">
          <h3 id="product-heading">当前产品</h3>
          <span>{selectedProduct?.model ?? "未选择"}</span>
        </div>
        <form className="priceForm" onSubmit={submitPrice}>
          <label>
            <span>直播价格</span>
            <input
              inputMode="decimal"
              placeholder="输入人民币金额"
              value={price}
              disabled={!selectedProduct}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!selectedProduct || !price.trim() || busy !== null}>
            更新价格
          </button>
        </form>
      </section>

      <section className="consoleSection" aria-labelledby="display-heading">
        <div className="sectionHeading">
          <h3 id="display-heading">展示控制</h3>
          <span>{state?.active_panel === "details" ? "DETAILS" : "SUMMARY"}</span>
        </div>
        <div className="segmentedControl" aria-label="展示面板">
          <button
            type="button"
            aria-pressed={state?.active_panel === "summary"}
            disabled={busy !== null}
            onClick={() =>
              void execute("panel-summary", {
                command: "set_panel",
                payload: { panel: "summary" }
              })
            }
          >
            产品摘要
          </button>
          <button
            type="button"
            aria-pressed={state?.active_panel === "details"}
            disabled={busy !== null}
            onClick={() =>
              void execute("panel-details", {
                command: "set_panel",
                payload: { panel: "details" }
              })
            }
          >
            参数详情
          </button>
        </div>
        <div className="commandRow">
          <AnimationButton
            label="价格高亮"
            name="price_highlight"
            disabled={!selectedProduct || busy !== null}
            execute={execute}
          />
          <AnimationButton
            label="产品聚焦"
            name="product_spotlight"
            disabled={!selectedProduct || busy !== null}
            execute={execute}
          />
        </div>
        <label className="toggleControl">
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
          <span>启用手势控制</span>
        </label>
      </section>

      <section className="consoleSection speechSection" aria-labelledby="speech-heading">
        <div className="sectionHeading">
          <h3 id="speech-heading">桌面语音</h3>
          <span>{speechCapabilityLabel(speech.status)}</span>
        </div>
        {speech.status !== "ready" ? (
          <button
            type="button"
            className="secondaryButton"
            disabled={busy !== null}
            onClick={() => void speech.initialize()}
          >
            初始化语音
          </button>
        ) : (
          <div className="commandRow">
            {state?.speech.phase === "listening" ? (
              <button
                type="button"
                className="secondaryButton"
                onClick={() =>
                  void execute("speech-stop", {
                    command: "speech_stopped",
                    payload: {}
                  })
                }
              >
                停止并审核
              </button>
            ) : (
              <button
                type="button"
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() =>
                  void execute("speech-start", {
                    command: "speech_started",
                    payload: {}
                  })
                }
              >
                开始识别
              </button>
            )}
          </div>
        )}
        {state?.speech.phase === "reviewing" ? (
          <div className="speechReview">
            <label>
              <span>识别草稿</span>
              <input
                value={reviewDraft}
                onChange={(event) => setReviewDraft(event.target.value)}
              />
            </label>
            <p>将在 {deadlineLabel(state.speech.deadline, clock)} 自动提交</p>
            <div className="commandRow">
              <button
                type="button"
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() =>
                  void execute("speech-edit", {
                    command: "speech_edit_draft",
                    payload: { text: reviewDraft }
                  })
                }
              >
                保存修改
              </button>
              <button
                type="button"
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() =>
                  void execute("speech-confirm", {
                    command: "speech_confirm",
                    payload: {}
                  })
                }
              >
                立即确认
              </button>
              <button
                type="button"
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() =>
                  void execute("speech-cancel", {
                    command: "speech_cancel",
                    payload: {}
                  })
                }
              >
                撤销
              </button>
            </div>
          </div>
        ) : null}
        {state?.speech.phase === "listening" ? (
          <p className="speechDraft" role="status">
            {state.speech.draft || "正在聆听…"}
          </p>
        ) : null}
        {state?.speech.phase === "error" ? (
          <div className="speechError">
            <span>{speechErrorLabel(state.speech.error_code)}</span>
            <button
              type="button"
              className="secondaryButton"
              onClick={() =>
                void execute("speech-cancel", {
                  command: "speech_cancel",
                  payload: {}
                })
              }
            >
              清除
            </button>
          </div>
        ) : null}
      </section>

      <section className="consoleSection pairingSection" aria-labelledby="pairing-heading">
        <div className="sectionHeading">
          <h3 id="pairing-heading">手机控制</h3>
          <span>{pairing ? "可扫描" : "未配对"}</span>
        </div>
        {pairing ? (
          <div className="pairingContent">
            <img src={pairing.qrDataUrl} alt="手机控制二维码" />
            <p>{pairing.phoneUrl}</p>
          </div>
        ) : (
          <button
            type="button"
            className="secondaryButton"
            disabled={busy !== null}
            onClick={() => void loadPairing()}
          >
            生成配对二维码
          </button>
        )}
      </section>

      <section className="consoleSection sessionActions" aria-label="场次操作">
        <button type="button" className="dangerButton" onClick={() => setConfirmEnd(true)}>
          结束场次
        </button>
      </section>

      <section className="consoleSection deviceStrip" aria-label="设备状态">
        <DeviceStatus label="手机控制" value={pairing ? "等待连接" : "未配对"} />
        <DeviceStatus label="第二摄像头" value="未初始化" />
        <DeviceStatus label="桌面语音" value={speechCapabilityLabel(speech.status)} />
      </section>

      {confirmEnd ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="confirmDialog">
            <h3 id="end-title">确认结束当前场次？</h3>
            <p>本场临时价格、草稿和手机控制权限将被清除。</p>
            <div className="commandRow">
              <button type="button" className="secondaryButton" onClick={() => setConfirmEnd(false)}>
                取消
              </button>
              <button
                type="button"
                className="dangerButton"
                disabled={busy !== null}
                onClick={() => {
                  void execute("end-session", {
                    command: "end_session",
                    payload: {}
                  }).then(() => {
                    setConfirmEnd(false);
                    setPairing(null);
                  });
                }}
              >
                确认结束
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
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
  execute: (key: string, command: StudioCommand) => Promise<void>;
}) {
  return (
    <button
      type="button"
      className="secondaryButton"
      disabled={disabled}
      onClick={() =>
        void execute(`animation-${name}`, {
          command: "trigger_animation",
          payload: { name }
        })
      }
    >
      {label}
    </button>
  );
}

function DeviceStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="deviceStatus">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function speechLabel(phase: string | undefined): string {
  const labels: Record<string, string> = {
    idle: "空闲",
    listening: "识别中",
    reviewing: "等待确认",
    committing: "正在提交",
    error: "发生错误"
  };
  return phase ? labels[phase] ?? "未知" : "未初始化";
}

function speechCapabilityLabel(status: string): string {
  const labels: Record<string, string> = {
    uninitialized: "未初始化",
    ready: "可用",
    unsupported: "浏览器不支持",
    denied: "权限被拒绝",
    unavailable: "暂不可用"
  };
  return labels[status] ?? "未知";
}

function speechErrorLabel(errorCode: string | null): string {
  const labels: Record<string, string> = {
    EMPTY_SPEECH: "没有识别到内容",
    INVALID_PRICE: "无法识别有效价格",
    PRICE_OUT_OF_RANGE: "价格超过允许范围",
    NO_PRODUCT_SELECTED: "请先选择产品",
    SPEECH_DENIED: "麦克风权限被拒绝",
    SPEECH_UNAVAILABLE: "语音服务暂不可用",
    SPEECH_REMOTE_START_FAILED: "远程启动语音失败"
  };
  return errorCode ? labels[errorCode] ?? "语音操作失败" : "语音操作失败";
}

function deadlineLabel(deadline: string | null, now: number): string {
  if (!deadline) {
    return "短暂延迟后";
  }
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return `${seconds} 秒后`;
}
