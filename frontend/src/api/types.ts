export type ActivePanel = "summary" | "details";
export type SpeechPhase = "idle" | "listening" | "reviewing" | "committing" | "error";
export type SpeechTarget = "search" | "price";
export type SpeechCapabilityStatus =
  | "uninitialized"
  | "ready"
  | "unsupported"
  | "denied"
  | "unavailable";
export type ConnectionStatus = "loading" | "connecting" | "connected" | "disconnected";

export type ProductSummary = {
  id: string;
  category: string;
  name: string;
  model: string;
  image: string;
};

export type ProductDetails = ProductSummary & {
  specs: Array<{
    label: string;
    value: string;
  }>;
};

export type AnimationName = "price_highlight" | "product_spotlight";

export type AnimationEvent = {
  type: "animation";
  event_id: string;
  name: AnimationName;
  product_id: string | null;
  issued_at: string;
};

export type SessionState = {
  schema_version: 1;
  session_id: string;
  selected_product_id: string | null;
  active_panel: ActivePanel;
  prices: Record<string, number>;
  gesture: {
    enabled: boolean;
    last_accepted_at: string | null;
  };
  speech: {
    phase: SpeechPhase;
    target: SpeechTarget;
    draft: string;
    deadline: string | null;
    error_code: string | null;
  };
  revision: number;
  started_at: string;
  updated_at: string;
};

export type BootstrapResponse = {
  config: {
    ws_studio: string;
    ws_control: string;
    speech_capability?: SpeechCapabilityStatus;
  };
  products: ProductSummary[];
  state: SessionState;
};

export type StateEvent = {
  type: "state";
  event_id: string;
  revision: number;
  state: SessionState;
};

export type PingEvent = {
  type: "ping";
};

export type AckEvent = {
  type: "ack";
  request_id: string;
  ok: boolean;
  revision: number;
  error: {
    code: string;
    message: string;
    details: {
      state?: SessionState;
      [key: string]: unknown;
    };
  } | null;
};

export type SpeechCapabilityEvent = {
  type: "speech_capability";
  status: SpeechCapabilityStatus;
};

export type ServerEvent =
  | StateEvent
  | PingEvent
  | AnimationEvent
  | AckEvent
  | SpeechCapabilityEvent;

export type StudioModel = {
  products: ProductSummary[];
  productDetails: ProductDetails | null;
  state: SessionState | null;
  animation: AnimationEvent | null;
  connection: ConnectionStatus;
  error: string | null;
  speechCapability?: SpeechCapabilityStatus;
};

export type StudioCommand =
  | { command: "select_product"; payload: { product_id: string } }
  | { command: "set_price"; payload: { product_id: string; raw_value: string } }
  | { command: "set_panel"; payload: { panel: ActivePanel } }
  | { command: "set_gesture_enabled"; payload: { enabled: boolean } }
  | { command: "speech_set_target"; payload: { target: SpeechTarget } }
  | { command: "speech_started"; payload: Record<string, never> }
  | { command: "speech_interim"; payload: { text: string } }
  | { command: "speech_stopped"; payload: { text?: string } }
  | { command: "speech_edit_draft"; payload: { text: string } }
  | { command: "speech_confirm"; payload: Record<string, never> }
  | { command: "speech_cancel"; payload: Record<string, never> }
  | { command: "speech_failed"; payload: { error_code: string } }
  | { command: "speech_capability"; payload: { status: SpeechCapabilityStatus } }
  | { command: "trigger_animation"; payload: { name: AnimationName } }
  | { command: "end_session"; payload: Record<string, never> };

export type StudioController = StudioModel & {
  sendCommand(command: StudioCommand): Promise<AckEvent>;
};

export type ControlCommand = Exclude<
  StudioCommand,
  { command: "end_session" | "speech_capability" | "speech_interim" | "speech_failed" }
>;
export type ControlAccess = "validating" | "ready" | "occupied" | "invalid";

export type ControlController = StudioModel & {
  access: ControlAccess;
  sendCommand(command: ControlCommand): Promise<AckEvent>;
};
