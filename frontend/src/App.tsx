import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import type { StudioController } from "./api/types";
import { LiveCaptureFrame } from "./components/LiveCaptureFrame";
import { PrivateConsole } from "./components/PrivateConsole";
import { MobileControl } from "./features/mobile/MobileControl";
import { useControlSession } from "./features/mobile/useControlSession";
import {
  outputResolutionById,
  type OutputResolution
} from "./features/live/outputResolution";
import { useStudioSession } from "./features/session/useStudioSession";

const OUTPUT_RESOLUTION_KEY = "live-background-output-resolution";

export function StudioPage() {
  const model = useStudioSession();
  return <StudioView model={model} />;
}

export function StudioView({ model }: { model: StudioController }) {
  const [outputResolution, setOutputResolution] = useState<OutputResolution>(() =>
    outputResolutionById(window.localStorage.getItem(OUTPUT_RESOLUTION_KEY))
  );
  const selectedSummary =
    model.products.find((product) => product.id === model.state?.selected_product_id) ?? null;
  const selectedProduct =
    model.productDetails?.id === model.state?.selected_product_id
      ? model.productDetails
      : selectedSummary;

  useEffect(() => {
    window.localStorage.setItem(OUTPUT_RESOLUTION_KEY, outputResolution.id);
  }, [outputResolution]);

  return (
    <main className="studioPage">
      <LiveCaptureFrame
        product={selectedProduct}
        details={model.productDetails}
        state={model.state}
        animation={model.animation}
        resolution={outputResolution}
      />
      <PrivateConsole
        model={model}
        selectedProduct={selectedSummary}
        outputResolution={outputResolution}
        onOutputResolutionChange={setOutputResolution}
      />
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
