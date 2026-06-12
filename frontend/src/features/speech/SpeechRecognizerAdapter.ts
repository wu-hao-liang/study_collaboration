export type SpeechError = {
  code: "denied" | "unavailable";
};

export interface SpeechRecognizerAdapter {
  isSupported(): boolean;
  start(language: "zh-CN"): Promise<void>;
  stop(): void;
  abort(): void;
  onInterim(callback: (text: string) => void): () => void;
  onFinal(callback: (text: string) => void): () => void;
  onError(callback: (error: SpeechError) => void): () => void;
}

type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};

type RecognitionErrorEvent = {
  error: string;
};

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export class BrowserSpeechRecognizer implements SpeechRecognizerAdapter {
  private recognition: RecognitionInstance | null = null;
  private interimListeners = new Set<(text: string) => void>();
  private finalListeners = new Set<(text: string) => void>();
  private errorListeners = new Set<(error: SpeechError) => void>();

  isSupported(): boolean {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  start(language: "zh-CN"): Promise<void> {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      return Promise.reject(new Error("unsupported"));
    }
    if (!this.recognition) {
      this.recognition = new Constructor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.onresult = (event) => this.handleResult(event);
      this.recognition.onerror = (event) => {
        const code = ["not-allowed", "service-not-allowed"].includes(event.error)
          ? "denied"
          : "unavailable";
        for (const listener of this.errorListeners) {
          listener({ code });
        }
      };
    }
    this.recognition.lang = language;
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        reject(new Error("unavailable"));
        return;
      }
      this.recognition.onstart = resolve;
      try {
        this.recognition.start();
      } catch (error) {
        reject(error);
      }
    });
  }

  stop(): void {
    this.recognition?.stop();
  }

  abort(): void {
    this.recognition?.abort();
  }

  onInterim(callback: (text: string) => void): () => void {
    this.interimListeners.add(callback);
    return () => this.interimListeners.delete(callback);
  }

  onFinal(callback: (text: string) => void): () => void {
    this.finalListeners.add(callback);
    return () => this.finalListeners.delete(callback);
  }

  onError(callback: (error: SpeechError) => void): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  private handleResult(event: RecognitionEvent): void {
    let interim = "";
    let final = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        final += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    if (interim) {
      for (const listener of this.interimListeners) {
        listener(interim);
      }
    }
    if (final) {
      for (const listener of this.finalListeners) {
        listener(final);
      }
    }
  }
}
