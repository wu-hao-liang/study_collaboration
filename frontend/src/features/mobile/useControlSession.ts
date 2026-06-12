import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBootstrap, validateControlToken, websocketUrl } from "../../api/http";
import type {
  AckEvent,
  ControlCommand,
  ControlController,
  ServerEvent,
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

function controlClientId(): string {
  const key = "live-background-control-client";
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export function useControlSession(token: string): ControlController {
  const [model, setModel] = useState<StudioModel>(INITIAL_MODEL);
  const [access, setAccess] = useState<ControlController["access"]>("validating");
  const socketRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(model.state);
  const pendingRef = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    stateRef.current = model.state;
  }, [model.state]);

  useEffect(() => {
    const abortController = new AbortController();
    const clientId = controlClientId();
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let stopped = false;

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
      const query = new URLSearchParams({ token, client_id: clientId });
      socket = new WebSocket(websocketUrl(`${path}?${query.toString()}`));
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        setAccess("ready");
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
        if (event.type === "state") {
          setModel((current) => ({ ...current, state: event.state }));
          return;
        }
        if (event.type === "animation") {
          setModel((current) => ({ ...current, animation: event }));
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
      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        for (const pending of pendingRef.current.values()) {
          pending.reject(new Error("connection closed"));
        }
        pendingRef.current.clear();
        if (stopped) {
          return;
        }
        const closeEvent = event as CloseEvent;
        if (closeEvent.code === 4009) {
          setAccess("occupied");
          setModel((current) => ({
            ...current,
            connection: "disconnected",
            error: null
          }));
          return;
        }
        if (closeEvent.code === 4003) {
          setAccess("invalid");
          setModel((current) => ({
            ...current,
            connection: "disconnected",
            error: null
          }));
          return;
        }
        setModel((current) => ({
          ...current,
          connection: "disconnected",
          error: "连接已中断，正在恢复"
        }));
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        setModel((current) => ({
          ...current,
          error: "无法连接本地控制服务"
        }));
      });
    };

    const start = async () => {
      try {
        const [validation, bootstrap] = await Promise.all([
          validateControlToken(token, abortController.signal),
          fetchBootstrap(abortController.signal)
        ]);
        if (stopped) {
          return;
        }
        if (!validation.valid) {
          setAccess("invalid");
          setModel((current) => ({ ...current, connection: "disconnected" }));
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
        connect(bootstrap.config.ws_control);
      } catch {
        if (stopped || abortController.signal.aborted) {
          return;
        }
        setModel((current) => ({
          ...current,
          connection: "disconnected",
          error: "无法载入手机控制端"
        }));
        scheduleReconnect();
      }
    };

    const startupTimer = window.setTimeout(() => void start(), 0);
    return () => {
      stopped = true;
      window.clearTimeout(startupTimer);
      abortController.abort();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close(1000, "page_unload");
    };
  }, [token]);

  const sendCommand = useCallback((controlCommand: ControlCommand): Promise<AckEvent> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("实时连接未就绪"));
    }
    const requestId = crypto.randomUUID();
    const envelope = {
      type: "command",
      request_id: requestId,
      command: controlCommand.command,
      payload: controlCommand.payload,
      ...(controlCommand.command === "trigger_animation"
        ? {}
        : { expected_revision: stateRef.current?.revision })
    };
    return new Promise<AckEvent>((resolve, reject) => {
      pendingRef.current.set(requestId, { resolve, reject });
      socket.send(JSON.stringify(envelope));
    });
  }, []);

  return { ...model, access, sendCommand };
}
