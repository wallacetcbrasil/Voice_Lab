import { api } from "./apiClient";

export type SetupStage = "not-installed" | "installed" | "initialized";
export type ModelStage = "not-required" | "missing" | "available" | "unloaded" | "loaded" | "error" | "unknown";

type LegacyStatus = "ready" | "missing" | "disabled" | "unavailable" | "experimental" | "error";

type InstallationPayload = boolean | string | {
  installed?: boolean;
  state?: string;
  detail?: string;
  detectedPath?: string;
};

type RuntimePayload = boolean | string | {
  initialized?: boolean;
  running?: boolean;
  state?: string;
  detail?: string;
  endpoint?: string;
  url?: string;
};

type ModelPayload = string | {
  state?: string;
  id?: string;
  detail?: string;
};

export interface SetupProbePayload {
  id?: string;
  label?: string;
  status?: LegacyStatus;
  stage?: string;
  installed?: boolean;
  initialized?: boolean;
  installation?: InstallationPayload;
  runtime?: RuntimePayload;
  runtimeState?: string;
  model?: ModelPayload;
  modelState?: string;
  version?: string;
  detail?: string;
  url?: string;
  detectedPath?: string;
  searchedPaths?: string[];
  installCommand?: string;
  startCommand?: string;
  stopCommand?: string;
  conflictGroup?: string;
}

export interface SetupStatusPayload {
  checkedAt: string;
  executionHost: {
    platform: string;
    architecture: string;
    deployment: string;
    note: string;
  };
  base: Record<string, SetupProbePayload>;
  runtimes: Record<string, SetupProbePayload>;
  services: Array<{ id: string; label: string } & SetupProbePayload>;
}

export interface SetupProbe extends SetupProbePayload {
  id: string;
  label: string;
  stage: SetupStage;
  modelStage: ModelStage;
  runtimeDetail?: string;
  modelDetail?: string;
}

const LABELS: Record<string, string> = {
  node: "Node.js",
  npm: "npm",
  git: "Git",
  python: "Python",
  lmStudio: "LM Studio",
  llamaCpp: "llama.cpp",
  pythonBridge: "Bridge Python",
  piper: "Piper",
  kokoro: "Kokoro",
  whisper: "Faster-Whisper",
  xtts: "XTTS-v2",
  openvoice: "OpenVoice V2",
  rvc: "RVC",
  qwen: "Transformers multimodal",
  transformers: "Transformers multimodal",
  realtime: "Realtime WebSocket",
};

function normalizedValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
}

function installationFound(probe: SetupProbePayload) {
  if (probe.installed !== undefined) return probe.installed;
  if (typeof probe.installation === "boolean") return probe.installation;
  if (typeof probe.installation === "string") return ["installed", "ready", "found"].includes(normalizedValue(probe.installation));
  if (probe.installation?.installed !== undefined) return probe.installation.installed;
  const installationState = normalizedValue(probe.installation?.state);
  if (["installed", "ready", "found"].includes(installationState)) return true;
  if (probe.detectedPath || probe.installation?.detectedPath) return true;
  return /bin[aá]rio encontrado|depend[eê]ncia encontrada|reconhecido no caminho/i.test(probe.detail || "");
}

function runtimeRunning(probe: SetupProbePayload) {
  if (probe.initialized !== undefined) return probe.initialized;
  if (typeof probe.runtime === "boolean") return probe.runtime;
  if (typeof probe.runtime === "string") return ["running", "initialized", "online", "ready"].includes(normalizedValue(probe.runtime));
  if (probe.runtime?.initialized !== undefined) return probe.runtime.initialized;
  if (probe.runtime?.running !== undefined) return probe.runtime.running;
  const runtimeState = normalizedValue(probe.runtime?.state || probe.runtimeState);
  return ["running", "initialized", "online", "ready"].includes(runtimeState);
}

function resolveStage(probe: SetupProbePayload): SetupStage {
  const explicit = normalizedValue(probe.stage);
  if (["not-installed", "missing", "uninstalled"].includes(explicit)) return "not-installed";
  if (["installed", "stopped"].includes(explicit)) return "installed";
  if (["initialized", "running", "online", "ready"].includes(explicit)) return "initialized";
  if (runtimeRunning(probe)) return "initialized";
  if (installationFound(probe)) return "installed";
  if (probe.status === "ready") return "initialized";
  return "not-installed";
}

function resolveModel(probe: SetupProbePayload): { stage: ModelStage; detail?: string } {
  const raw = typeof probe.model === "string"
    ? probe.model
    : probe.model?.state || probe.modelState;
  const value = normalizedValue(raw);
  if (["not-required", "none", "not-applicable"].includes(value)) return { stage: "not-required", detail: typeof probe.model === "object" ? probe.model.detail : undefined };
  if (["missing", "not-installed", "not-downloaded"].includes(value)) return { stage: "missing", detail: typeof probe.model === "object" ? probe.model.detail : undefined };
  if (["available", "downloaded", "configured"].includes(value)) return { stage: "available", detail: typeof probe.model === "object" ? probe.model.detail || probe.model.id : undefined };
  if (value === "unloaded") return { stage: "unloaded", detail: typeof probe.model === "object" ? probe.model.detail || probe.model.id : undefined };
  if (["loaded", "active", "running"].includes(value)) return { stage: "loaded", detail: typeof probe.model === "object" ? probe.model.detail || probe.model.id : undefined };
  if (value === "error") return { stage: "error", detail: typeof probe.model === "object" ? probe.model.detail || probe.model.id : undefined };
  return { stage: "unknown", detail: typeof probe.model === "object" ? probe.model.detail || probe.model.id : undefined };
}

export function normalizeSetupProbe(id: string, payload: SetupProbePayload): SetupProbe {
  const model = resolveModel(payload);
  const runtimeDetail = typeof payload.runtime === "object" ? payload.runtime.detail : undefined;
  return {
    ...payload,
    id,
    label: payload.label || LABELS[id] || id,
    stage: resolveStage(payload),
    modelStage: model.stage,
    modelDetail: model.detail,
    runtimeDetail,
  };
}

export function flattenSetupStatus(status?: SetupStatusPayload): SetupProbe[] {
  if (!status) return [];
  return [
    ...Object.entries(status.base || {}).map(([id, probe]) => normalizeSetupProbe(id, probe)),
    ...Object.entries(status.runtimes || {}).map(([id, probe]) => normalizeSetupProbe(id, probe)),
    ...(status.services || []).map((probe) => normalizeSetupProbe(probe.id, probe)),
  ];
}

export async function fetchSetupStatus() {
  const payload = await api<{ data: SetupStatusPayload }>("/api/setup/status");
  return payload.data;
}
