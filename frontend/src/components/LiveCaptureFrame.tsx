import type { CSSProperties } from "react";

import type {
  AnimationEvent,
  ProductDetails,
  ProductSummary,
  SessionState
} from "../api/types";
import { formatPrice } from "../features/live/formatPrice";
import type { OutputResolution } from "../features/live/outputResolution";

const DESIGN_WIDTH = 720;

type LiveCaptureFrameProps = {
  product: ProductSummary | null;
  details: ProductDetails | null;
  state: SessionState | null;
  animation: AnimationEvent | null;
  resolution: OutputResolution;
};

export function LiveCaptureFrame({
  product,
  details,
  state,
  animation,
  resolution
}: LiveCaptureFrameProps) {
  const activePanel = state?.active_panel ?? "summary";
  const price =
    product && state ? formatPrice(state.prices[product.id] ?? null) : "价格待定";
  const animationTargetsCurrentProduct =
    animation?.product_id === null || animation?.product_id === product?.id;
  const animationClass = animationTargetsCurrentProduct ? `animation-${animation?.name}` : "";

  const designScale = resolution.width / DESIGN_WIDTH;
  const frameStyle = {
    "--output-width": `${resolution.width}px`,
    "--output-height": `${resolution.height}px`,
    "--design-scale": designScale
  } as CSSProperties;

  return (
    <section
      className="captureColumn"
      aria-label="直播采集区域"
      style={frameStyle}
    >
      <div className="captureHeader" aria-hidden="true">
        <span>LIVE OUTPUT</span>
        <span>
          {resolution.width} × {resolution.height}
        </span>
      </div>
      <div className="captureStage">
        <div className="captureMat">
          <div className="cropMark cropMarkTopLeft" />
          <div className="cropMark cropMarkTopRight" />
          <div className="cropMark cropMarkBottomLeft" />
          <div className="cropMark cropMarkBottomRight" />
          <div
            className="liveCanvas"
            data-live-canvas
            data-output-width={resolution.width}
            data-output-height={resolution.height}
          >
            <div className="liveDesignSurface">
              <div className="liveBrand">冰箱选购咨询</div>
              {product ? (
                <div
                  key={animation?.event_id ?? "stable"}
                  className={`livePanels panel-${activePanel} ${animationClass}`}
                >
                  <SummaryPanel
                    product={product}
                    price={price}
                    active={activePanel === "summary"}
                  />
                  <DetailsPanel
                    product={product}
                    details={details}
                    active={activePanel === "details"}
                  />
                  <div className="animationFlash" aria-hidden="true" />
                </div>
              ) : (
                <div className="liveWaiting">
                  <p>直播即将开始</p>
                  <h1>今天选一台合适的冰箱</h1>
                  <span>等待主持人选择产品</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="captureHint">红线内为直播伴侣采集范围</p>
    </section>
  );
}

function SummaryPanel({
  product,
  price,
  active
}: {
  product: ProductSummary;
  price: string;
  active: boolean;
}) {
  return (
    <article
      className="livePanel summaryPanel"
      aria-hidden={!active}
      data-panel="summary"
    >
      <div className="productImageStage">
        <img src={product.image} alt="" />
      </div>
      <div className="summaryCopy">
        <p className="liveCategory">{product.category}</p>
        <h1>{product.name}</h1>
        <p className="liveModel">{product.model}</p>
        <p className="livePrice">{price}</p>
      </div>
    </article>
  );
}

function DetailsPanel({
  product,
  details,
  active
}: {
  product: ProductSummary;
  details: ProductDetails | null;
  active: boolean;
}) {
  const specs = details?.id === product.id ? details.specs.slice(0, 8) : [];
  return (
    <article
      className="livePanel detailsPanel"
      aria-hidden={!active}
      data-panel="details"
    >
      <div className="detailsHeader">
        <div>
          <p className="liveCategory">{product.category}</p>
          <h1>{product.name}</h1>
          <p className="liveModel">{product.model}</p>
        </div>
        <img src={product.image} alt="" />
      </div>
      <dl className="specTable">
        {specs.length ? (
          specs.map((spec) => (
            <div key={spec.label}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))
        ) : (
          <div className="specLoading">
            <dt>产品参数</dt>
            <dd>正在读取</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
