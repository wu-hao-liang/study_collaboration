import { useCallback, useEffect, useRef, useState } from "react";

import type { SpeechCapabilityStatus, StudioController } from "../../api/types";
import {
  BrowserSpeechRecognizer,
  type SpeechRecognizerAdapter
} from "./SpeechRecognizerAdapter";

export function useDesktopSpeech(
  model: StudioController,
  adapter: SpeechRecognizerAdapter = new BrowserSpeechRecognizer()
) {
  const adapterRef = useRef(adapter);
  const [status, setStatus] = useState<SpeechCapabilityStatus>("uninitialized");
  const listeningRef = useRef(false);
  const sendCommand = model.sendCommand;

  const publishStatus = useCallback(
    async (nextStatus: SpeechCapabilityStatus) => {
      setStatus(nextStatus);
      try {
        await sendCommand({
          command: "speech_capability",
          payload: { status: nextStatus }
        });
      } catch {
        // The visible connection state already communicates transport failure.
      }
    },
    [sendCommand]
  );

  const initialize = useCallback(async () => {
    const recognizer = adapterRef.current;
    if (!recognizer.isSupported()) {
      await publishStatus("unsupported");
      return;
    }
    try {
      await recognizer.start("zh-CN");
      recognizer.stop();
      await publishStatus("ready");
    } catch {
      await publishStatus("denied");
    }
  }, [publishStatus]);

  useEffect(() => {
    const recognizer = adapterRef.current;
    const sendText = (text: string) => {
      void sendCommand({
        command: "speech_interim",
        payload: { text }
      });
    };
    const removeInterim = recognizer.onInterim(sendText);
    const removeFinal = recognizer.onFinal(sendText);
    const removeError = recognizer.onError((error) => {
      listeningRef.current = false;
      void publishStatus(error.code);
      void sendCommand({
        command: "speech_failed",
        payload: { error_code: `SPEECH_${error.code.toUpperCase()}` }
      });
    });
    return () => {
      removeInterim();
      removeFinal();
      removeError();
      recognizer.abort();
    };
  }, [publishStatus, sendCommand]);

  useEffect(() => {
    const recognizer = adapterRef.current;
    if (model.state?.speech.phase === "listening" && status === "ready") {
      if (!listeningRef.current) {
        listeningRef.current = true;
        void recognizer.start("zh-CN").catch(() => {
          listeningRef.current = false;
          void publishStatus("unavailable");
          void sendCommand({
            command: "speech_failed",
            payload: { error_code: "SPEECH_REMOTE_START_FAILED" }
          });
        });
      }
      return;
    }
    if (listeningRef.current) {
      listeningRef.current = false;
      recognizer.stop();
    }
  }, [model.state?.speech.phase, publishStatus, sendCommand, status]);

  return { status, initialize };
}
