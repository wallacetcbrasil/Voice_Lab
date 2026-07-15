import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const windows = process.platform === "win32";

export function getVoiceLabHome() {
  if (process.env.VOICE_LAB_HOME) return resolve(process.env.VOICE_LAB_HOME);
  if (windows && process.env.LOCALAPPDATA) return resolve(process.env.LOCALAPPDATA, "VoiceLab");
  return resolve(homedir(), ".voice-lab");
}

export const voiceLabHome = getVoiceLabHome();

/**
 * Resolve executables without relying only on the PATH inherited by Node.
 * Winget updates the user PATH after installation, so the same setup process
 * must also inspect conventional shim/package locations.
 */
export function resolveExecutable(command) {
  if (existsSync(command)) return resolve(command);
  const suffixes = windows && !command.toLowerCase().endsWith(".exe")
    ? [".exe", ".cmd", ".bat", ""]
    : [""];
  const pathEntries = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const winGetLinks = windows && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links")
    : undefined;
  const lmStudioBin = windows ? join(homedir(), ".lmstudio", "bin") : undefined;

  for (const directory of [...pathEntries, winGetLinks, lmStudioBin].filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }

  const packageRoot = windows && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : undefined;
  if (packageRoot && existsSync(packageRoot)) {
    const wanted = suffixes.map((suffix) => `${command}${suffix}`.toLowerCase());
    try {
      for (const entry of readdirSync(packageRoot, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !wanted.includes(entry.name.toLowerCase())) continue;
        const parent = entry.parentPath || entry.path;
        if (parent) return join(parent, entry.name);
      }
    } catch {
      // The diagnostics layer will report it as missing without accepting arbitrary paths.
    }
  }
  return undefined;
}

export const engineManifest = {
  bridge: { label: "Bridge Python", python: "3.11", port: 8000, requirements: "requirements.txt", probe: "import fastapi,uvicorn,multipart" },
  piper: { label: "Piper", python: "3.11", requirements: "requirements-piper.txt", probe: "import piper" },
  kokoro: { label: "Kokoro", python: "3.11", port: 8101, requirements: "requirements-kokoro.txt", probe: "import kokoro,soundfile" },
  whisper: { label: "Faster-Whisper", python: "3.11", port: 8102, requirements: "requirements-whisper.txt", probe: "import faster_whisper" },
  xtts: { label: "XTTS-v2", python: "3.11", port: 8103, requirements: "requirements-xtts.txt", probe: "from TTS.api import TTS" },
  openvoice: { label: "OpenVoice V2", python: "3.9", port: 8104, requirements: "requirements-openvoice.txt", probe: "from openvoice.api import ToneColorConverter; from melo.api import TTS" },
  rvc: { label: "RVC", python: "3.10", port: 8105, requirements: "requirements-rvc.txt", probe: "import rvc" },
  transformers: { label: "Transformers multimodal", python: "3.11", port: 8106, requirements: "requirements-transformers.txt", probe: "import transformers,torch,soundfile" },
};

export function engineEnvDir(id) {
  return join(voiceLabHome, "envs", id);
}

export function enginePython(id) {
  return windows ? join(engineEnvDir(id), "Scripts", "python.exe") : join(engineEnvDir(id), "bin", "python");
}

export function engineExecutable(id, name) {
  const suffix = windows ? ".exe" : "";
  return windows ? join(engineEnvDir(id), "Scripts", `${name}${suffix}`) : join(engineEnvDir(id), "bin", `${name}${suffix}`);
}

export function statePath() {
  return join(voiceLabHome, "setup-state.json");
}

export function readVoiceLabState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { version: 2, engines: {}, runtimes: {} };
  }
}

export function writeVoiceLabState(state) {
  mkdirSync(voiceLabHome, { recursive: true });
  writeFileSync(statePath(), `${JSON.stringify({ version: 2, ...state }, null, 2)}\n`, "utf8");
}

export function isEngineInstalled(id, spawnSync) {
  const manifest = engineManifest[id];
  const python = enginePython(id);
  if (!manifest || !existsSync(python)) return false;
  const result = spawnSync(python, ["-c", manifest.probe], { windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) return false;
  if (id === "piper") return existsSync(join(voiceLabHome, "models", "piper", "pt_BR-faber-medium.onnx"));
  return true;
}

export function runtimeDir() {
  return join(voiceLabHome, "runtime");
}

export function runtimePidPath(id) {
  return join(runtimeDir(), `${id}.json`);
}

export function writeRuntimePid(id, data) {
  mkdirSync(runtimeDir(), { recursive: true });
  writeFileSync(runtimePidPath(id), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readRuntimePid(id) {
  try {
    return JSON.parse(readFileSync(runtimePidPath(id), "utf8"));
  } catch {
    return undefined;
  }
}
