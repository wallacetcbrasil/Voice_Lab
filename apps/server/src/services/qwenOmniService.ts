import { AppError } from "../errors.js";
import { pythonJson, pythonMultipart } from "./pythonBridge.js";

export async function qwenText(body: Record<string, unknown>) {
  if (!String(body.prompt || "").trim()) throw new AppError(400, "PROMPT_REQUIRED", "Informe um prompt.");
  return pythonJson("transformers", "/api/transformers/voxtral/text", body);
}

export async function qwenAudio(body: Record<string, string>, file?: Express.Multer.File) {
  if (!file) throw new AppError(400, "AUDIO_REQUIRED", "Envie áudio para o modelo Omni.");
  return pythonMultipart("transformers", "/api/transformers/voxtral/audio", body, file);
}

export async function qwenAudioToAudio(body: Record<string, string>, file?: Express.Multer.File) {
  if (!file) throw new AppError(400, "AUDIO_REQUIRED", "Envie áudio para o modo audio-to-audio.");
  return pythonMultipart("transformers", "/api/transformers/voxtral/audio-to-audio", body, file);
}
