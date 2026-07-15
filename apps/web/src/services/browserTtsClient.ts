export interface SpeakOptions {
  voiceURI?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

export function getVoices() {
  return window.speechSynthesis?.getVoices() || [];
}

export function speak(text: string, options: SpeakOptions = {}) {
  if (!("speechSynthesis" in window)) throw new Error("speechSynthesis não é suportado neste navegador.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? 1;
  utterance.lang = options.lang ?? "pt-BR";
  utterance.pitch = options.pitch ?? 1;
  utterance.volume = options.volume ?? 1;
  utterance.voice = getVoices().find((voice) => voice.voiceURI === options.voiceURI) || null;
  if (options.onStart) utterance.onstart = options.onStart;
  if (options.onEnd) utterance.onend = options.onEnd;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}
