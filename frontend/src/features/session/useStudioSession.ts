import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBootstrap, fetchProduct, websocketUrl } from "../../api/http";
import type {
  AckEvent,
  ServerEvent,
  StudioCommand,
  StudioController,
  StudioModel
} from "../../api/types";

const INITIAL_MODEL: StudioModel = {
  products: [],
  productDetails: null,
  state: null,
  animation: null,
  connection: "loading",
  error: null
};

type PendingRequest = {
  resolve: (ack: AckEvent) => void;
  reject: (error: Error) => void;
};

export function useStudioSession(): StudioController {
  const [model, setModel] = useState<StudioModel>(INITIAL_MODEL);
  const socketRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(model.state);
  const pendingRef = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    stateRef.current = model.state;
  }, [model.state]);

  useEffect(() => {
    const abortController = new AbortController();
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disconnectNoticeTimer: number | null = null;
    let reconnectAttempt = 0;
    let stopped = false;
    const seenAnimationIds = new Set<string>();

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void start();
      }, delay);
    };

    const connect = (path: string) => {
      setModel((current) => ({ ...current, connection: "connecting" }));
      socket = new WebSocket(websocketUrl(path));
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (disconnectNoticeTimer !== null) {
          window.clearTimeout(disconnectNoticeTimer);
          disconnectNoticeTimer = null;
        }
        reconnectAttempt = 0;
        setModel((current) => ({
          ...current,
          connection: "connected",
          error: null
        }));
      });
      socket.addEventListener("message", (message) => {
        const event = JSON.parse(String(message.data)) as ServerEvent;
        if (event.type === "ping") {
          socket?.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (event.type === "state" && "state" in event) {
          setModel((current) => ({
            ...current,
            state: event.state
          }));
          return;
        }
        if (
          event.type === "animation" &&
          "event_id" in event &&
          !seenAnimationIds.has(event.event_id)
        ) {
          seenAnimationIds.add(event.event_id);
          setModel((current) => ({
            ...current,
            animation: event
          }));
          return;
        }
        if (event.type === "ack") {
          const pending = pendingRef.current.get(event.request_id);
          if (!pending) {
            return;
          }
          pendingRef.current.delete(event.request_id);
          if (!event.ok && event.error?.details.state) {
            setModel((current) => ({
              ...current,
              state: event.error?.details.state ?? current.state,
              error: event.error?.message ?? "操作失败"
            }));
          } else if (!event.ok) {
            setModel((current) => ({
              ...current,
              error: event.error?.message ?? "操作失败"
            }));
          }
          pending.resolve(event);
          return;
        }
        if (event.type === "speech_capability") {
          setModel((current) => ({
            ...current,
            speechCapability: event.status
          }));
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        for (const pending of pendingRef.current.values()) {
          pending.reject(new Error("connection closed"));
        }
        pendingRef.current.clear();
        if (stopped) {
          return;
        }
        setModel((current) => ({
          ...current,
          connection: "connecting"
        }));
        if (disconnectNoticeTimer === null) {
          disconnectNoticeTimer = window.setTimeout(() => {
            disconnectNoticeTimer = null;
            if (!stopped && socketRef.current === null) {
              setModel((current) => ({
                ...current,
                connection: "disconnected",
                error: "实时连接暂时不可用，仍在重连"
              }));
            }
          }, 2500);
        }
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        // The close handler owns reconnect status so brief transport errors stay quiet.
      });
    };

    const start = async () => {
      try {
        const bootstrap = await fetchBootstrap(abortController.signal);
        if (stopped) {
          return;
        }
        setModel({
          products: bootstrap.products,
          productDetails: null,
          state: bootstrap.state,
          animation: null,
          connection: "connecting",
          error: null,
          speechCapability: bootstrap.config.speech_capability ?? "uninitialized"
        });
        connect(bootstrap.config.ws_studio);
      } catch (error) {
        if (stopped || abortController.signal.aborted) {
          return;
        }
        setModel((current) => ({
          ...current,
          connection: "disconnected",
          error: error instanceof Error ? "无法加载本地工作台" : "工作台初始化失败"
        }));
        scheduleReconnect();
      }
    };

    void start();

    return () => {
      stopped = true;
      abortController.abort();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (disconnectNoticeTimer !== null) {
        window.clearTimeout(disconnectNoticeTimer);
      }
      socket?.close(1000, "page_unload");
    };
  }, []);

  useEffect(() => {
    const productId = model.state?.selected_product_id;
    if (!productId) {
      setModel((current) =>
        current.productDetails === null ? current : { ...current, productDetails: null }
      );
      return;
    }
    if (model.productDetails?.id === productId) {
      return;
    }

    const controller = new AbortController();
    void fetchProduct(productId, controller.signal)
      .then((productDetails) => {
        setModel((current) =>
          current.state?.selected_product_id === productDetails.id
            ? { ...current, productDetails }
            : current
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setModel((current) => ({
            ...current,
            error: "无法加载当前产品详情"
          }));
        }
      });
    return () => controller.abort();
  }, [model.productDetails?.id, model.state?.selected_product_id]);

  const sendCommand = useCallback((studioCommand: StudioCommand): Promise<AckEvent> => {
    const socket = socketRef.current;
    const state = stateRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("实时连接未就绪"));
    }
    const requestId = crypto.randomUUID();
    const persistent = !["trigger_animation", "speech_capability"].includes(
      studioCommand.command
    );
    const envelope = {
      type: "command",
      request_id: requestId,
      command: studioCommand.command,
      payload: studioCommand.payload,
      ...(persistent ? { expected_revision: state?.revision } : {})
    };
    return new Promise<AckEvent>((resolve, reject) => {
      pendingRef.current.set(requestId, { resolve, reject });
      socket.send(JSON.stringify(envelope));
    });
  }, []);

  return { ...model, sendCommand };
}
