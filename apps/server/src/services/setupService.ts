import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { appConfig, rootDir, voiceLabHome } from "../config.js";
import type { InstallationStage, LifecycleDiagnostic, ModelDiagnostic, RuntimeDiagnostic } from "../types.js";
import { getCapabilities } from "./capabilityService.js";
import { diagnoseLlamaCpp } from "./llamaCppService.js";
import { listModels } from "./lmStudioClient.js";
import { pythonBridgeAuthHeaders, type PythonBridgeEngine } from "./pythonBridge.js";

const execFileAsync = promisify(execFile);

type LegacyStatus = "ready" | "missing" | "unavailable" | "error";
type SetupProbe = LifecycleDiagnostic & {
  status: LegacyStatus;
  detail: string;
  version?: string;
  url?: string;
  detectedPath?: string;
  searchedPaths?: string[];
};

const pythonVersions: Record<PythonBridgeEngine, string> = {
  bridge: "3.11",
  kokoro: "3.11",
  whisper: "3.11",
  xtts: "3.11",
  openvoice: "3.9",
  rvc: "3.10",
  transformers: "3.11",
};

const pythonModules: Record<PythonBridgeEngine, string[]> = {
  bridge: ["fastapi", "uvicorn", "multipart"],
  kokoro: ["kokoro", "soundfile"],
  whisper: ["faster_whisper"],
  xtts: ["TTS"],
  openvoice: ["openvoice", "melo", "pkg_resources"],
  rvc: ["rvc"],
  transformers: ["transformers", "torch", "soundfile"],
};

const engineLabels: Record<PythonBridgeEngine, string> = {
  bridge: "Bridge Python",
  kokoro: "Kokoro",
  whisper: "Faster-Whisper",
  xtts: "XTTS-v2",
  openvoice: "OpenVoice V2",
  rvc: "RVC",
  transformers: "Transformers multimodal",
};

function legacyStatus(stage: InstallationStage, runtime: RuntimeDiagnostic): LegacyStatus {
  if (runtime.state === "error") return "error";
  if (stage === "initialized") return "ready";
  if (stage === "installed") return "unavailable";
  return "missing";
}

function lifecycleProbe(input: Omit<SetupProbe, "status"> & { status?: LegacyStatus }): SetupProbe {
  return { ...input, status: input.status || legacyStatus(input.stage, input.runtime) };
}

async function commandVersion(command: string, args = ["--version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5_000, windowsHide: true });
    return { installed: true, version: (stdout || stderr).trim().split(/\r?\n/)[0] || "reconhecido", command };
  } catch {
    return { installed: false, version: "", command };
  }
}

function installedTool(detail: string, version?: string): SetupProbe {
  return lifecycleProbe({
    stage: "installed",
    installation: { installed: true, detail },
    runtime: { state: "not-applicable", detail: "Ferramenta de linha de comando; não mantém um servidor próprio." },
    model: { state: "not-required" },
    detail,
    version,
    status: "ready",
  });
}

function missingTool(detail: string): SetupProbe {
  return lifecycleProbe({
    stage: "not-installed",
    installation: { installed: false, detail },
    runtime: { state: "not-applicable" },
    model: { state: "not-required" },
    detail,
    status: "missing",
  });
}

function pythonExecutableCandidates(engine: PythonBridgeEngine) {
  const version = pythonVersions[engine];
  const executableParts = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
  return [
    join(voiceLabHome, "envs", engine, ...executableParts),
    join(voiceLabHome, ".venv", ...executableParts),
    join(rootDir, ".venv", ...executableParts),
    join(homedir(), ".venv", ...executableParts),
    process.platform === "win32" ? "python.exe" : `python${version}`,
  ];
}

async function probePythonInstallation(engine: PythonBridgeEngine) {
  const modules = pythonModules[engine];
  const expression = modules.map((module) => `importlib.util.find_spec(${JSON.stringify(module)}) is not None`).join(" and ");
  const code = `import importlib.util,sys;sys.exit(0 if ${expression} else 1)`;
  const searchedPaths = pythonExecutableCandidates(engine);
  for (const candidate of searchedPaths) {
    if ((candidate.includes("\\") || candidate.includes("/")) && !existsSync(candidate)) continue;
    try {
      await execFileAsync(candidate, ["-c", code], { timeout: 8_000, windowsHide: true });
      return { installed: true, detectedPath: candidate, searchedPaths };
    } catch {
      // Continue until every conventional environment has been checked.
    }
  }
  return { installed: false, detectedPath: undefined, searchedPaths };
}

type BridgeHealth = {
  online: boolean;
  engineAvailable: boolean;
  detail: string;
  url: string;
  model?: { configured?: boolean; loaded?: boolean; model?: string; path?: string; models?: string[] };
};

async function probePythonRuntime(engine: PythonBridgeEngine): Promise<BridgeHealth> {
  const url = appConfig.pythonBaseUrls[engine];
  try {
    const response = await fetch(`${url}/health?deep=true`, {
      headers: pythonBridgeAuthHeaders(false),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as {
      engines?: Record<string, {
        available?: boolean;
        installed?: boolean;
        initialized?: boolean;
        selected?: boolean;
        model?: { configured?: boolean; loaded?: boolean; model?: string; path?: string; models?: string[] };
      } | boolean>;
    };
    if (engine === "bridge") {
      return { online: true, engineAvailable: true, detail: "Bridge base respondeu.", url };
    }
    const aliases = engine === "transformers" ? ["transformers", "qwen"] : [engine];
    const reported = aliases.map((id) => payload.engines?.[id]).find((value) => value !== undefined);
    const available = typeof reported === "boolean"
      ? reported
      : Boolean(reported?.available ?? reported?.initialized ?? (reported?.installed && reported?.selected));
    return {
      online: true,
      engineAvailable: available,
      detail: available ? `${engineLabels[engine]} respondeu e confirmou a dependência.` : `O processo respondeu, mas não confirmou ${engineLabels[engine]}.`,
      url,
      model: typeof reported === "object" ? reported.model : undefined,
    };
  } catch {
    return { online: false, engineAvailable: false, detail: "Bridge não iniciado nesta porta.", url };
  }
}

function pythonModel(engine: PythonBridgeEngine, health?: BridgeHealth): ModelDiagnostic {
  if (engine === "bridge") return { state: "not-required" };
  if (health?.model?.loaded) {
    return { state: "loaded", detail: `Checkpoint carregado${health.model.model ? `: ${health.model.model}` : ""}.` };
  }
  if (health?.model?.configured === false) {
    return { state: "missing", detail: health.model.path ? `Checkpoint não encontrado no caminho esperado: ${health.model.path}.` : "Checkpoint ainda não configurado." };
  }
  if (health?.model?.configured) {
    return {
      state: "unloaded",
      detail: `Checkpoint definido${health.model.model ? ` (${health.model.model})` : ""}; será carregado somente durante a inferência.`,
    };
  }
  if (["kokoro", "whisper", "xtts"].includes(engine)) {
    return { state: "unloaded", detail: "O checkpoint é carregado somente na primeira execução do laboratório." };
  }
  const configuredPath = engine === "openvoice"
    ? process.env.OPENVOICE_MODEL_PATH
    : engine === "rvc"
      ? process.env.RVC_MODEL_PATH
      : process.env.VOXTRAL_MODEL_PATH;
  if (configuredPath && existsSync(resolve(configuredPath))) {
    return { state: "available", detail: `Checkpoint localizado em ${resolve(configuredPath)}; ainda não foi carregado.` };
  }
  return { state: "missing", detail: "A ferramenta está separada do checkpoint; escolha um modelo compatível no laboratório." };
}

async function probePythonEngine(engine: PythonBridgeEngine): Promise<SetupProbe> {
  const [installation, health] = await Promise.all([
    probePythonInstallation(engine),
    probePythonRuntime(engine),
  ]);
  const installed = installation.installed || (health.online && health.engineAvailable);
  const initialized = installed && health.online && health.engineAvailable;
  const runtime: RuntimeDiagnostic = initialized
    ? { state: "running", detail: health.detail, url: health.url }
    : health.online
      ? { state: "error", detail: health.detail, url: health.url }
      : { state: "stopped", detail: health.detail, url: health.url };
  const stage: InstallationStage = initialized ? "initialized" : installed ? "installed" : "not-installed";
  return lifecycleProbe({
    stage,
    installation: {
      installed,
      detail: installed ? `Dependências encontradas para ${engineLabels[engine]}.` : `Dependências de ${engineLabels[engine]} não encontradas.`,
    },
    runtime,
    model: pythonModel(engine, health),
    detail: initialized ? health.detail : installed ? `${engineLabels[engine]} instalado; bridge ainda não inicializado.` : `Dependências de ${engineLabels[engine]} não encontradas.`,
    url: health.url,
    detectedPath: installation.detectedPath,
    searchedPaths: installation.searchedPaths,
    startCommand: "npm run companion",
    stopCommand: "npm run runtime -- stop companion",
    conflictGroup: engine === "transformers" ? "heavy-inference" : undefined,
  });
}

async function findLmsCli() {
  const candidates = process.platform === "win32"
    ? [join(homedir(), ".lmstudio", "bin", "lms.exe"), "lms.exe", "lms"]
    : [join(homedir(), ".lmstudio", "bin", "lms"), "lms"];
  for (const candidate of candidates) {
    if ((candidate.includes("\\") || candidate.includes("/")) && !existsSync(candidate)) continue;
    const probe = await commandVersion(candidate);
    if (probe.installed) return { ...probe, searchedPaths: candidates };
  }
  return { installed: false, version: "", command: "", searchedPaths: candidates };
}

async function probeLmStudio(): Promise<SetupProbe> {
  const cli = await findLmsCli();
  let online = false;
  let exposedModels = 0;
  try {
    const payload = await listModels();
    exposedModels = Array.isArray((payload as { data?: unknown[] }).data) ? (payload as { data: unknown[] }).data.length : 0;
    online = true;
  } catch {
    // Installed and initialized are intentionally independent.
  }
  let loadedModels = -1;
  if (cli.installed) {
    try {
      const { stdout } = await execFileAsync(cli.command, ["ps", "--json"], { timeout: 8_000, windowsHide: true });
      const payload = JSON.parse(stdout) as unknown;
      loadedModels = Array.isArray(payload) ? payload.length : 0;
    } catch {
      loadedModels = -1;
    }
  }
  const installed = cli.installed || online;
  const model: ModelDiagnostic = loadedModels > 0
    ? { state: "loaded", detail: `${loadedModels} modelo(s) carregado(s).` }
    : loadedModels === 0
      ? { state: "unloaded", detail: "Nenhum modelo carregado; a API pode ser iniciada sem ocupar memória de modelo." }
      : exposedModels > 0
        ? { state: "available", detail: `${exposedModels} modelo(s) exposto(s); o estado de carga não pôde ser confirmado pela CLI.` }
        : { state: "missing", detail: "Nenhum modelo foi detectado." };
  const stage: InstallationStage = online ? "initialized" : installed ? "installed" : "not-installed";
  return lifecycleProbe({
    stage,
    installation: { installed, detail: cli.installed ? `CLI reconhecida: ${cli.version}` : online ? "API local respondeu; CLI não foi localizada no PATH atual." : "LM Studio não foi localizado." },
    runtime: { state: online ? "running" : "stopped", detail: online ? "Servidor OpenAI-compatible respondeu." : "Servidor local desligado.", url: appConfig.lmStudioBaseUrl },
    model,
    detail: online ? "Servidor local respondeu." : installed ? "Instalado; servidor desligado." : "Aplicativo não encontrado.",
    version: cli.version || undefined,
    url: appConfig.lmStudioBaseUrl,
    detectedPath: cli.installed ? cli.command : undefined,
    searchedPaths: cli.searchedPaths,
    startCommand: "npm run runtime -- start lmstudio",
    stopCommand: "npm run runtime -- stop lmstudio",
    conflictGroup: "heavy-inference",
  });
}

async function probeLlamaCpp(): Promise<SetupProbe> {
  const diagnosis = await diagnoseLlamaCpp(appConfig.llamaCppBaseUrl);
  const installed = diagnosis.binaryFound;
  const initialized = diagnosis.serverOnline;
  const stage: InstallationStage = initialized ? "initialized" : installed ? "installed" : "not-installed";
  const model: ModelDiagnostic = diagnosis.models.length > 0
    ? { state: "loaded", detail: `${diagnosis.models.length} modelo(s) anunciado(s) pelo llama-server.` }
    : initialized
      ? { state: "missing", detail: "Servidor online sem modelo anunciado." }
      : { state: "unloaded", detail: "O comando de inicialização carrega somente o GGUF escolhido pelo usuário." };
  return lifecycleProbe({
    stage,
    installation: { installed, detail: installed ? "Binário llama-server encontrado." : "Binário llama-server não encontrado nos caminhos convencionais." },
    runtime: { state: initialized ? "running" : "stopped", detail: initialized ? "llama-server respondeu." : "Servidor desligado.", url: diagnosis.baseUrl },
    model,
    detail: initialized ? "llama-server respondeu." : installed ? "Binário encontrado; servidor desligado." : "Binário não encontrado.",
    url: diagnosis.baseUrl,
    detectedPath: diagnosis.binaryPath || undefined,
    searchedPaths: ["PATH do sistema", "PATH do usuário", "pacote Winget ggml.llamacpp", "tools/llama.cpp/build/bin/Release"],
    startCommand: "npm run runtime -- start llama",
    stopCommand: "npm run runtime -- stop llama",
    conflictGroup: "heavy-inference",
  });
}

function piperProbe(): SetupProbe {
  const service = appConfig.services.piper;
  const binaryInstalled = Boolean(service.binary && existsSync(service.binary));
  const modelAvailable = Boolean(service.model && existsSync(service.model));
  const initialized = binaryInstalled && modelAvailable;
  const stage: InstallationStage = initialized ? "initialized" : binaryInstalled ? "installed" : "not-installed";
  return lifecycleProbe({
    stage,
    installation: { installed: binaryInstalled, detail: binaryInstalled ? "Executável Piper encontrado." : "Executável Piper não encontrado." },
    runtime: initialized
      ? { state: "on-demand", detail: "O Companion chama o binário apenas durante a síntese." }
      : { state: "stopped", detail: "A síntese não pode iniciar sem binário e voz." },
    model: modelAvailable
      ? { state: "available", detail: "Voz ONNX pt-BR localizada; carregada somente ao gerar áudio." }
      : { state: "missing", detail: "A voz ONNX ainda não foi localizada." },
    detail: initialized ? "Binário e voz prontos para execução sob demanda." : binaryInstalled ? "Piper instalado; falta uma voz ONNX." : "Piper não instalado.",
    detectedPath: initialized ? `${service.binary} · ${service.model}` : binaryInstalled ? service.binary : undefined,
    searchedPaths: [...service.binarySearchedPaths, ...service.searchedPaths],
    startCommand: "npm run companion",
    stopCommand: "npm run runtime -- stop companion",
  });
}

function realtimeProbe(): SetupProbe {
  return lifecycleProbe({
    stage: "initialized",
    installation: { installed: true, detail: "Transporte WebSocket integrado ao Companion." },
    runtime: { state: "running", detail: "O endpoint /api/realtime está no processo Node atual." },
    model: { state: "not-required", detail: "O transporte não carrega modelo por conta própria." },
    detail: "Transporte WebSocket inicializado no Companion.",
    startCommand: "npm run companion",
    stopCommand: "npm run runtime -- stop companion",
  });
}

export async function getSetupStatus() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const pythonCommand = process.platform === "win32" ? "python.exe" : "python3";
  const [npm, git, python, lmStudio, llamaCpp, pythonBridge, kokoro, whisper, xtts, openvoice, rvc, transformers] = await Promise.all([
    process.platform === "win32" ? commandVersion("cmd.exe", ["/d", "/s", "/c", `${npmCommand} --version`]) : commandVersion(npmCommand),
    commandVersion("git"),
    commandVersion(pythonCommand),
    probeLmStudio(),
    probeLlamaCpp(),
    probePythonEngine("bridge"),
    probePythonEngine("kokoro"),
    probePythonEngine("whisper"),
    probePythonEngine("xtts"),
    probePythonEngine("openvoice"),
    probePythonEngine("rvc"),
    probePythonEngine("transformers"),
  ]);

  const base = {
    node: lifecycleProbe({
      stage: "initialized",
      installation: { installed: true, detail: "Node executa o Companion atual." },
      runtime: { state: "running", detail: `Processo Node ${process.pid} em execução.` },
      model: { state: "not-required" },
      detail: "Node executa o Companion atual.",
      version: process.version,
      status: "ready",
    }),
    npm: npm.installed ? installedTool("npm reconhecido.", npm.version) : missingTool("npm não encontrado."),
    git: git.installed ? installedTool("Git reconhecido.", git.version) : missingTool("Git não encontrado."),
    python: python.installed
      ? installedTool("Python do sistema reconhecido; os motores usam ambientes isolados.", python.version)
      : pythonBridge.installation.installed
        ? installedTool("Python gerenciado pelo uv foi reconhecido no ambiente isolado do Voice Lab.", "ambiente uv")
        : missingTool("Python global ou gerenciado não encontrado; execute o instalador único."),
  };

  const serviceProbes: Record<string, SetupProbe> = {
    piper: piperProbe(),
    kokoro,
    whisper,
    xtts,
    openvoice,
    rvc,
    transformers,
    realtime: realtimeProbe(),
  };
  const services = getCapabilities().map((capability) => ({
    ...capability,
    ...serviceProbes[capability.id],
    label: capability.label,
  }));

  return {
    checkedAt: new Date().toISOString(),
    executionHost: {
      platform: process.platform,
      architecture: process.arch,
      deployment: process.env.VERCEL ? "Vercel" : process.env.NETLIFY ? "Netlify" : process.env.RENDER ? "Render" : process.env.RAILWAY_ENVIRONMENT ? "Railway" : "host atual",
      note: "As sondas de runtime verificam o host do Companion. Em uma publicação Vercel, os modelos continuam no computador pareado do usuário.",
    },
    base,
    runtimes: { lmStudio, llamaCpp, pythonBridge },
    services,
  };
}
