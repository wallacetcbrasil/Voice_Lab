import { AppError } from "../errors.js";
import { appConfig } from "../config.js";

export interface ChatInput {
  baseUrl?: string;
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
  temperature?: number;
  stream?: boolean;
}

export interface NativeLmStudioModel {
  type?: string;
  publisher?: string;
  key?: string;
  display_name?: string;
  architecture?: string | null;
  quantization?: { name?: string | null; bits_per_weight?: number | null } | null;
  size_bytes?: number;
  params_string?: string | null;
  loaded_instances?: Array<{ id?: string; config?: Record<string, unknown> }>;
  format?: string | null;
  capabilities?: Record<string, unknown>;
  description?: string | null;
  variants?: string[];
  selected_variant?: string;
}

export interface AudioModelVariant {
  id: string;
  quantization: string;
  sizeBytes: number;
  sizeLabel: string;
  loaded: boolean;
  loadedInstanceIds: string[];
}

export interface AudioModelGroup {
  familyId: string;
  displayName: string;
  publisher: string;
  architecture: string;
  params: string;
  format: string;
  audioEvidence: "runtime-capability" | "known-audio-family";
  variants: AudioModelVariant[];
}

export function assertLocalUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(400, "INVALID_RUNTIME_URL", "A URL do runtime é inválida.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new AppError(400, "LOCAL_RUNTIME_ONLY", "Por segurança, a versão base aceita apenas runtimes locais.", "Use localhost, 127.0.0.1 ou ::1.");
  }
  return url.toString().replace(/\/$/, "");
}

function nativeApiUrl(baseUrl: string) {
  const url = new URL(assertLocalUrl(baseUrl));
  return `${url.protocol}//${url.host}/api/v1/models`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "tamanho não informado";
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function explicitAudioCapability(capabilities: Record<string, unknown> | undefined) {
  if (!capabilities) return false;
  const flattened = JSON.stringify(capabilities).toLowerCase();
  return (
    capabilities.audio === true ||
    capabilities.audio_input === true ||
    capabilities.supports_audio === true ||
    /"audio"\s*:\s*true/.test(flattened) ||
    /"audio_input"\s*:\s*true/.test(flattened)
  );
}

// Conservador por intenção: não aceite "omni" genérico. Nomes como OmniCoder não
// implicam áudio. Estas famílias têm entrada de áudio documentada em seus model cards.
const knownAudioFamilies = [
  /\bqwen2[._-]?5[._-]?omni\b/i,
  /\bqwen3[._-]?omni\b/i,
  /\bqwen2[._-]?audio\b/i,
  /\bminicpm[._-]?o(?:\b|[-_])/i,
  /\bphi[._-]?4[._-]?multimodal\b/i,
  /\bvoxtral\b/i,
  /\bultravox\b/i,
];

function audioEvidence(model: NativeLmStudioModel): AudioModelGroup["audioEvidence"] | null {
  if (explicitAudioCapability(model.capabilities)) return "runtime-capability";
  const identity = [model.key, model.display_name, model.architecture, model.description].filter(Boolean).join(" ");
  return knownAudioFamilies.some((pattern) => pattern.test(identity)) ? "known-audio-family" : null;
}

function familyKey(modelKey: string) {
  return modelKey.replace(/@[^@/]+$/i, "").toLowerCase();
}

export function normalizeAudioModels(models: NativeLmStudioModel[]): AudioModelGroup[] {
  const groups = new Map<string, AudioModelGroup>();

  for (const model of models) {
    if (model.type !== "llm" || !model.key) continue;
    const evidence = audioEvidence(model);
    if (!evidence) continue;
    const familyId = familyKey(model.key);
    const loadedInstanceIds = (model.loaded_instances || []).map((instance) => instance.id).filter((id): id is string => Boolean(id));
    const group = groups.get(familyId) || {
      familyId,
      displayName: (model.display_name || familyId).replace(/\s+UD$/i, ""),
      publisher: model.publisher || "desconhecido",
      architecture: model.architecture || "não informada",
      params: model.params_string || "não informado",
      format: model.format || "não informado",
      audioEvidence: evidence,
      variants: [],
    };

    group.variants.push({
      id: model.key,
      quantization: model.quantization?.name || model.key.split("@").at(-1)?.toUpperCase() || "não informada",
      sizeBytes: model.size_bytes || 0,
      sizeLabel: formatBytes(model.size_bytes || 0),
      loaded: loadedInstanceIds.length > 0,
      loadedInstanceIds,
    });
    groups.set(familyId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      variants: group.variants.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.sizeBytes - b.sizeBytes),
    }))
    .sort((a, b) => Number(b.variants.some((variant) => variant.loaded)) - Number(a.variants.some((variant) => variant.loaded)) || a.displayName.localeCompare(b.displayName));
}

function mapRuntimeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new AppError(504, "RUNTIME_TIMEOUT", "O runtime local excedeu o tempo limite.", "Reduza o contexto ou verifique GPU/memória.");
  }
  return new AppError(503, "RUNTIME_OFFLINE", "Não foi possível conectar ao runtime local.", "Inicie o servidor, carregue o modelo e confira a Base URL.");
}

function runtimeHeaders(includeJson = false) {
  const headers: Record<string, string> = {};
  if (includeJson) headers["content-type"] = "application/json";
  if (process.env.LM_STUDIO_API_TOKEN) headers.authorization = `Bearer ${process.env.LM_STUDIO_API_TOKEN}`;
  return headers;
}

export async function listModels(baseUrl = appConfig.lmStudioBaseUrl) {
  try {
    const response = await fetch(`${assertLocalUrl(baseUrl)}/models`, { headers: runtimeHeaders(), signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new AppError(response.status, "MODELS_ERROR", `Runtime respondeu HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export async function listAudioModels(baseUrl = appConfig.lmStudioBaseUrl) {
  try {
    const response = await fetch(nativeApiUrl(baseUrl), {
      headers: runtimeHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new AppError(response.status, "NATIVE_MODELS_ERROR", `LM Studio respondeu HTTP ${response.status} ao listar modelos.`);
    const payload = await response.json() as { models?: NativeLmStudioModel[] };
    const models = normalizeAudioModels(payload.models || []);
    return {
      models,
      totalAudioFamilies: models.length,
      totalAudioVariants: models.reduce((total, model) => total + model.variants.length, 0),
      loadedAudioVariants: models.flatMap((model) => model.variants).filter((variant) => variant.loaded).length,
      readOnly: true,
      note: "A descoberta apenas lista metadados; nenhum modelo é carregado.",
    };
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export async function chatCompletion(input: ChatInput) {
  const baseUrl = assertLocalUrl(input.baseUrl || appConfig.lmStudioBaseUrl);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: runtimeHeaders(true),
      body: JSON.stringify({
        model: input.model || appConfig.lmStudioModel,
        messages: input.messages,
        temperature: input.temperature ?? 0.3,
        stream: false,
      }),
      signal: AbortSignal.timeout(appConfig.timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(response.status, "MODEL_RESPONSE_ERROR", data?.error?.message || `Runtime respondeu HTTP ${response.status}.`, "Confirme se o Model ID carregado corresponde ao configurado.");
    }
    return data;
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export async function streamChat(input: ChatInput, clientSignal?: AbortSignal) {
  const baseUrl = assertLocalUrl(input.baseUrl || appConfig.lmStudioBaseUrl);
  try {
    const timeoutSignal = AbortSignal.timeout(appConfig.timeoutMs);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: runtimeHeaders(true),
      body: JSON.stringify({
        model: input.model || appConfig.lmStudioModel,
        messages: input.messages,
        temperature: input.temperature ?? 0.3,
        stream: true,
      }),
      signal: clientSignal ? AbortSignal.any([clientSignal, timeoutSignal]) : timeoutSignal,
    });
    if (!response.ok || !response.body) {
      const data = await response.text();
      throw new AppError(response.status, "STREAM_ERROR", data || "Streaming indisponível.", "Desative streaming ou atualize o runtime.");
    }
    return response.body;
  } catch (error) {
    throw mapRuntimeError(error);
  }
}
