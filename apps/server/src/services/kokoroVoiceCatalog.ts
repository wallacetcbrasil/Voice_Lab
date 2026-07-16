import { AppError } from "../errors.js";

export interface KokoroVoice {
  id: string;
  name: string;
  language: string;
  languageLabel: string;
  gender: "female" | "male";
}

const languageDefinitions = {
  "pt-br": { label: "Português do Brasil", prefix: "p" },
  "en-us": { label: "Inglês americano", prefix: "a" },
  "en-gb": { label: "Inglês britânico", prefix: "b" },
  es: { label: "Espanhol", prefix: "e" },
  "fr-fr": { label: "Francês", prefix: "f" },
  hi: { label: "Hindi", prefix: "h" },
  it: { label: "Italiano", prefix: "i" },
  ja: { label: "Japonês", prefix: "j" },
  zh: { label: "Mandarim", prefix: "z" },
} as const;

const voiceIds = [
  "pf_dora", "pm_alex", "pm_santa",
  "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis", "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
] as const;

const languageByPrefix = Object.fromEntries(
  Object.entries(languageDefinitions).map(([language, definition]) => [definition.prefix, { language, label: definition.label }]),
) as Record<string, { language: string; label: string }>;

export const kokoroVoices: KokoroVoice[] = voiceIds.map((id) => {
  const definition = languageByPrefix[id[0]];
  const name = id.slice(3).split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  return {
    id,
    name,
    language: definition.language,
    languageLabel: definition.label,
    gender: id[1] === "f" ? "female" : "male",
  };
});

export function listKokoroVoices() {
  return {
    model: "hexgrad/Kokoro-82M",
    source: "bundled-catalog-for-fixed-model",
    languages: Object.entries(languageDefinitions).map(([id, definition]) => ({ id, label: definition.label })),
    voices: kokoroVoices,
  };
}

export function validateKokoroVoice(voice: unknown, language: unknown) {
  const selectedVoice = String(voice || "").trim();
  const selectedLanguage = String(language || "").trim().toLowerCase();
  const match = kokoroVoices.find((candidate) => candidate.id === selectedVoice);
  if (!match) {
    throw new AppError(422, "KOKORO_VOICE_INVALID", "Selecione uma voz reconhecida no catálogo do Kokoro.");
  }
  if (match.language !== selectedLanguage) {
    throw new AppError(
      422,
      "KOKORO_VOICE_LANGUAGE_MISMATCH",
      `A voz ${match.id} pertence a ${match.languageLabel}, não ao idioma selecionado.`,
      "Escolha uma das vozes filtradas para o idioma atual.",
    );
  }
  return match;
}
