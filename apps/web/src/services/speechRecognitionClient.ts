export interface RecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string; confidence: number } };
  };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  }
}

export const speechRecognitionSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

export function createRecognition(options: {
  language?: string;
  continuous?: boolean;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}) {
  const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Constructor) throw new Error("SpeechRecognition não é suportado neste navegador.");
  const recognition = new Constructor();
  recognition.lang = options.language || "pt-BR";
  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let partial = "";
    let final = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) final += result[0].transcript;
      else partial += result[0].transcript;
    }
    if (partial) options.onPartial(partial);
    if (final) options.onFinal(final.trim());
  };
  recognition.onerror = (event) => options.onError(event.error || "Falha no reconhecimento.");
  recognition.onend = () => options.onEnd?.();
  return recognition;
}
