import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSpeechRecognizer } from "./SpeechRecognizerAdapter";

class FakeRecognition {
  static instance: FakeRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.instance = this;
  }

  start() {
    this.onstart?.();
  }
}

describe("BrowserSpeechRecognizer", () => {
  afterEach(() => {
    delete window.SpeechRecognition;
    FakeRecognition.instance = null;
  });

  it("wraps Chrome recognition and separates interim and final text", async () => {
    window.SpeechRecognition = FakeRecognition;
    const adapter = new BrowserSpeechRecognizer();
    const interim = vi.fn();
    const final = vi.fn();
    adapter.onInterim(interim);
    adapter.onFinal(final);

    await adapter.start("zh-CN");
    FakeRecognition.instance?.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "法式" } },
        { isFinal: true, 0: { transcript: "多门" } }
      ]
    });
    adapter.stop();

    expect(FakeRecognition.instance?.lang).toBe("zh-CN");
    expect(interim).toHaveBeenCalledWith("法式");
    expect(final).toHaveBeenCalledWith("多门");
    expect(FakeRecognition.instance?.stop).toHaveBeenCalled();
  });

  it("reports permission denial without exposing audio", async () => {
    window.SpeechRecognition = FakeRecognition;
    const adapter = new BrowserSpeechRecognizer();
    const onError = vi.fn();
    adapter.onError(onError);

    await adapter.start("zh-CN");
    FakeRecognition.instance?.onerror?.({ error: "not-allowed" });

    expect(onError).toHaveBeenCalledWith({ code: "denied" });
  });
});
