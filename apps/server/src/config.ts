import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(here, "../../..");
loadEnv({ path: resolve(rootDir, ".env"), quiet: true });

const enabled = (name: string) => process.env[name]?.toLowerCase() === "true";
const projectPath = (...parts: string[]) => resolve(rootDir, ...parts);
const platformHome = process.platform === "win32" && process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "VoiceLab")
  : resolve(homedir(), ".voice-lab");
export const voiceLabHome = resolve(process.env.VOICE_LAB_HOME || platformHome);
const homePath = (...parts: string[]) => resolve(voiceLabHome, ...parts);
const userVenvPath = (...parts: string[]) => resolve(homedir(), ".venv", ...parts);
const persistentVenvPath = (...parts: string[]) => resolve(voiceLabHome, ".venv", ...parts);
const engineVenvPath = (engine: string, ...parts: string[]) => resolve(voiceLabHome, "envs", engine, ...parts);
const engineSitePackages = (engine: string, pythonVersion = "3.11") => process.platform === "win32"
  ? engineVenvPath(engine, "Lib", "site-packages")
  : engineVenvPath(engine, "lib", `python${pythonVersion}`, "site-packages");
const firstExisting = (paths: string[]) => paths.find((path) => existsSync(path)) || "";

const configuredWebOrigins = (process.env.WEB_ORIGINS || process.env.WEB_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const defaultWebOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3333",
  "http://127.0.0.1:3333",
];
export const allowedWebOrigins = [...new Set([...defaultWebOrigins, ...configuredWebOrigins])];

export function isAllowedWebOrigin(origin?: string) {
  if (!origin) return true;
  return allowedWebOrigins.includes(origin);
}

const defaults = {
  piperBinary: process.platform === "win32"
    ? [engineVenvPath("piper", "Scripts", "piper.exe"), persistentVenvPath("Scripts", "piper.exe"), userVenvPath("Scripts", "piper.exe"), projectPath(".venv", "Scripts", "piper.exe")]
    : [engineVenvPath("piper", "bin", "piper"), persistentVenvPath("bin", "piper"), userVenvPath("bin", "piper"), projectPath(".venv", "bin", "piper")],
  piperModel: [homePath("models", "piper", "pt_BR-faber-medium.onnx"), projectPath("models", "piper", "pt_BR-faber-medium.onnx")],
  kokoro: [resolve(engineSitePackages("kokoro"), "kokoro"), persistentVenvPath("Lib", "site-packages", "kokoro"), userVenvPath("Lib", "site-packages", "kokoro"), projectPath(".venv", "Lib", "site-packages", "kokoro"), projectPath(".venv", "lib", "python3.11", "site-packages", "kokoro")],
  whisper: [resolve(engineSitePackages("whisper"), "faster_whisper"), persistentVenvPath("Lib", "site-packages", "faster_whisper"), userVenvPath("Lib", "site-packages", "faster_whisper"), projectPath(".venv", "Lib", "site-packages", "faster_whisper"), projectPath(".venv", "lib", "python3.11", "site-packages", "faster_whisper")],
  xtts: [resolve(engineSitePackages("xtts"), "TTS"), persistentVenvPath("Lib", "site-packages", "TTS"), userVenvPath("Lib", "site-packages", "TTS"), projectPath(".venv", "Lib", "site-packages", "TTS"), projectPath(".venv", "lib", "python3.11", "site-packages", "TTS")],
  openvoice: [resolve(engineSitePackages("openvoice", "3.9"), "openvoice"), homePath("tools", "OpenVoice"), projectPath("tools", "OpenVoice")],
  rvc: [resolve(engineSitePackages("rvc", "3.10"), "rvc"), homePath("tools", "RVC"), projectPath("tools", "RVC")],
  transformers: [resolve(engineSitePackages("transformers"), "transformers"), userVenvPath("Lib", "site-packages", "transformers"), projectPath(".venv", "Lib", "site-packages", "transformers"), projectPath(".venv", "lib", "python3.11", "site-packages", "transformers")],
};

function discoveredService(flag: string, configured: string | undefined, candidates: string[]) {
  const detected = configured || firstExisting(candidates);
  return {
    enabled: enabled(flag) || Boolean(detected),
    configuredBy: configured ? "environment" as const : detected ? "auto" as const : "none" as const,
    model: detected,
    searchedPaths: candidates,
  };
}

export const appConfig = {
  port: Number(process.env.PORT || 3333),
  // O Companion nunca deve ser exposto à rede. A publicação web conversa apenas
  // com este loopback pareado no computador do usuário.
  host: "127.0.0.1",
  webOrigins: allowedWebOrigins,
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120_000),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  logLimit: Number(process.env.LOG_LIMIT || 500),
  lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1",
  lmStudioModel: process.env.LM_STUDIO_MODEL || "ggml-org/Voxtral-Mini-3B-2507-GGUF",
  llamaCppBaseUrl: process.env.LLAMA_CPP_BASE_URL || "http://localhost:8080/v1",
  pythonBaseUrl: process.env.PYTHON_AUDIO_BASE_URL || "http://127.0.0.1:8000",
  pythonBaseUrls: {
    bridge: process.env.PYTHON_AUDIO_BASE_URL || "http://127.0.0.1:8000",
    kokoro: process.env.PYTHON_KOKORO_BASE_URL || "http://127.0.0.1:8101",
    whisper: process.env.PYTHON_WHISPER_BASE_URL || "http://127.0.0.1:8102",
    xtts: process.env.PYTHON_XTTS_BASE_URL || "http://127.0.0.1:8103",
    openvoice: process.env.PYTHON_OPENVOICE_BASE_URL || "http://127.0.0.1:8104",
    rvc: process.env.PYTHON_RVC_BASE_URL || "http://127.0.0.1:8105",
    transformers: process.env.PYTHON_TRANSFORMERS_BASE_URL || "http://127.0.0.1:8106",
  },
  services: {
    piper: {
      ...discoveredService("ENABLE_PIPER", process.env.PIPER_MODEL_PATH, defaults.piperModel),
      binary: process.env.PIPER_BIN_PATH || firstExisting(defaults.piperBinary),
      binarySearchedPaths: defaults.piperBinary,
    },
    kokoro: discoveredService("ENABLE_KOKORO", process.env.KOKORO_RUNTIME_PATH, defaults.kokoro),
    whisper: discoveredService("ENABLE_WHISPER", process.env.WHISPER_RUNTIME_PATH, defaults.whisper),
    xtts: discoveredService("ENABLE_XTTS", process.env.XTTS_RUNTIME_PATH, defaults.xtts),
    openvoice: discoveredService("ENABLE_OPENVOICE", process.env.OPENVOICE_RUNTIME_PATH, defaults.openvoice),
    rvc: discoveredService("ENABLE_RVC", process.env.RVC_RUNTIME_PATH, defaults.rvc),
    transformers: discoveredService("ENABLE_MULTIMODAL_TRANSFORMERS", process.env.TRANSFORMERS_RUNTIME_PATH, defaults.transformers),
    realtime: { enabled: true, configuredBy: "built-in" as const, model: "", searchedPaths: [] as string[] },
  },
};

export function pathState(path: string) {
  return path ? existsSync(path) : false;
}
