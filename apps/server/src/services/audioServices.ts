import { AppError } from "../errors.js";
import { pythonJson, pythonMultipart } from "./pythonBridge.js";
import { validateKokoroVoice } from "./kokoroVoiceCatalog.js";

export async function kokoro(text: string, voice: string, language: string, speed = 1) {
  validateKokoroVoice(voice, language);
  return pythonJson("kokoro", "/api/tts/kokoro", { text, voice, language, speed });
}

export async function whisper(file?: Express.Multer.File, language = "pt") {
  if (!file) throw new AppError(400, "AUDIO_REQUIRED", "Envie um arquivo de áudio.");
  return pythonMultipart("whisper", "/api/stt/whisper", { language }, file);
}

export function requireConsent(value: unknown) {
  if (!(value === true || value === "true")) {
    throw new AppError(403, "VOICE_CONSENT_REQUIRED", "Use apenas vozes próprias ou autorizadas.", "Marque a confirmação de autorização antes de continuar.");
  }
}

export async function xtts(fields: Record<string, string>, file?: Express.Multer.File) {
  requireConsent(fields.consentConfirmed);
  if (!file) throw new AppError(400, "REFERENCE_AUDIO_REQUIRED", "Envie um áudio de referência autorizado.");
  return pythonMultipart("xtts", "/api/voice-clone/xtts", fields, file);
}

export async function openVoice(fields: Record<string, string>, file?: Express.Multer.File) {
  requireConsent(fields.consentConfirmed);
  if (!file) throw new AppError(400, "REFERENCE_AUDIO_REQUIRED", "Envie um áudio de referência autorizado.");
  return pythonMultipart("openvoice", "/api/voice-clone/openvoice", fields, file);
}

export async function rvc(fields: Record<string, string>, file?: Express.Multer.File) {
  requireConsent(fields.consentConfirmed);
  if (!file) throw new AppError(400, "INPUT_AUDIO_REQUIRED", "Envie ou grave a voz de entrada.");
  return pythonMultipart("rvc", "/api/voice-conversion/rvc", fields, file);
}
