import type { StudioController } from "./api/types";
import { LiveCaptureFrame } from "./components/LiveCaptureFrame";
import { PrivateConsole } from "./components/PrivateConsole";
import { MobileControl } from "./features/mobile/MobileControl";
import { useControlSession } from "./features/mobile/useControlSession";
import { useStudioSession } from "./features/session/useStudioSession";
import { useParams } from "react-router-dom";

export function StudioPage() {
  const model = useStudioSession();
  return <StudioView model={model} />;
}

export function StudioView({ model }: { model: StudioController }) {
  const selectedSummary =
    model.products.find((product) => product.id === model.state?.selected_product_id) ?? null;
  const selectedProduct =
    model.productDetails?.id === model.state?.selected_product_id
      ? model.productDetails
      : selectedSummary;

  return (
    <main className="studioPage">
      <LiveCaptureFrame
        product={selectedProduct}
        details={model.productDetails}
        state={model.state}
        animation={model.animation}
      />
      <PrivateConsole model={model} selectedProduct={selectedSummary} />
    </main>
  );
}

export function ControlPage({ token }: { token: string }) {
  const model = useControlSession(token);
  return <MobileControl model={model} />;
}

export function ControlRoute() {
  const { token = "" } = useParams();
  return <ControlPage token={token} />;
}
