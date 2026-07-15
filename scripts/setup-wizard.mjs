#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  engineEnvDir,
  engineManifest,
  enginePython,
  isEngineInstalled,
  readVoiceLabState,
  resolveExecutable,
  voiceLabHome,
  windows,
  writeVoiceLabState,
} from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function commandWorks(command, args = ["--version"]) {
  const executable = resolveExecutable(command) || command;
  return spawnSync(executable, args, { windowsHide: true, stdio: "ignore" }).status === 0;
}

function pythonCheck(python, code) {
  return spawnSync(python, ["-c", code], { windowsHide: true, stdio: "ignore" }).status === 0;
}

const packageCache = new Map();
function packageInstalled(id, refresh = false) {
  if (!refresh && packageCache.has(id)) return packageCache.get(id);
  const installed = windows && commandWorks("winget.exe", ["list", "--id", id, "-e", "--accept-source-agreements"]);
  packageCache.set(id, installed);
  return installed;
}

function printable(command, args) {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part}"` : part).join(" ");
}

function run(command, args, { cwd = root, dryRun = false, env } = {}) {
  if (dryRun) {
    console.log(`    [prévia, não executado] ${printable(command, args)}`);
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`Código ${code}: ${printable(command, args)}`)));
  });
}

function selectedEngines() {
  const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice(7);
  if (!only) return Object.keys(engineManifest);
  const ids = only.split(",").map((id) => id.trim()).filter(Boolean);
  const invalid = ids.filter((id) => !engineManifest[id]);
  if (invalid.length) throw new Error(`Motor desconhecido: ${invalid.join(", ")}`);
  return [...new Set(["bridge", ...ids])];
}

async function installWinget(id, label, dryRun) {
  if (!windows || packageInstalled(id)) return "reused";
  await run("winget.exe", ["install", "--id", id, "-e", "--accept-package-agreements", "--accept-source-agreements"], { dryRun });
  if (!dryRun && !packageInstalled(id, true)) throw new Error(`${label} não foi reconhecido após o Winget.`);
  return "installed";
}

async function ensureUv(dryRun) {
  if (commandWorks("uv")) return;
  if (!windows) throw new Error("Instale uv conforme https://docs.astral.sh/uv/getting-started/installation/");
  await installWinget("astral-sh.uv", "uv", dryRun);
}

async function ensureEngine(id, dryRun, previouslyChecked) {
  const manifest = engineManifest[id];
  if (previouslyChecked ?? isEngineInstalled(id, spawnSync)) return "reused";
  const uv = resolveExecutable("uv") || (windows ? "uv.exe" : "uv");
  const envDir = engineEnvDir(id);
  const python = enginePython(id);
  const requirements = join(root, "python", manifest.requirements);

  if (!existsSync(python) || dryRun) {
    if (!dryRun) mkdirSync(dirname(envDir), { recursive: true });
    await run(uv, ["python", "install", manifest.python], { dryRun });
    await run(uv, ["venv", "--python", manifest.python, envDir], { dryRun });
  }
  await run(uv, ["pip", "install", "--python", python, "-r", requirements], {
    dryRun,
    env: id === "rvc" ? { READTHEDOCS: "1" } : undefined,
  });

  if (id === "openvoice") {
    await run(uv, [
      "pip", "install", "--python", python, "--no-deps",
      "git+https://github.com/myshell-ai/OpenVoice.git@74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
    ], { dryRun });
    const unidicReady = !dryRun && pythonCheck(
      python,
      "import pathlib, sys, unidic; sys.exit(0 if (pathlib.Path(unidic.DICDIR) / 'dicrc').is_file() else 1)",
    );
    if (!unidicReady) await run(python, ["-m", "unidic", "download"], { dryRun });
  }
  if (id === "rvc") {
    // The official package currently pins PyAV 11, which has no compatible
    // Windows wheel and would force users to install a C++ compiler. Runtime
    // dependencies above provide the compatible wheel; install RVC itself
    // from the pinned official commit without re-resolving that old pin.
    await run(uv, [
      "pip", "install", "--python", python, "--no-deps",
      "git+https://github.com/RVC-Project/Retrieval-based-Voice-Conversion.git@7b284a634667c34103eaaeed972b48ccdb4b893e",
    ], { dryRun });
  }
  if (id === "piper") {
    const voiceDir = join(voiceLabHome, "models", "piper");
    const model = join(voiceDir, "pt_BR-faber-medium.onnx");
    if (!existsSync(model) || dryRun) {
      if (!dryRun) mkdirSync(voiceDir, { recursive: true });
      await run(python, ["-m", "piper.download_voices", "pt_BR-faber-medium", "--data-dir", voiceDir], { dryRun });
    }
  }

  if (!dryRun && !isEngineInstalled(id, spawnSync)) throw new Error(`${manifest.label} não passou na importação real.`);
  return "installed";
}

export async function runSetupWizard(options = {}) {
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");
  const engines = options.engines ?? selectedEngines();
  const state = readVoiceLabState();
  const failures = [];

  console.log("\nVoice Lab — instalação completa");
  console.log(`Destino persistente: ${voiceLabHome}`);
  console.log("Primeiro verificamos tudo; depois instalamos somente o que estiver ausente.");
  console.log("Nenhum servidor ou modelo pesado será iniciado por este comando.\n");

  const systemTools = windows ? [
    ["Git.Git", "Git"],
    ["ElementLabs.LMStudio", "LM Studio"],
    ["ggml.llamacpp", "llama.cpp"],
    ["eSpeak-NG.eSpeak-NG", "eSpeak NG"],
    ["Gyan.FFmpeg", "FFmpeg"],
  ] : [];

  console.log("Pré-verificação:");
  console.log(`  Node.js: instalado (${process.version})`);
  console.log(`  uv: ${commandWorks("uv") ? "instalado" : "não instalado"}`);
  for (const [packageId, label] of systemTools) console.log(`  ${label}: ${packageInstalled(packageId) ? "instalado" : "não instalado"}`);
  const engineChecks = new Map();
  for (const id of engines) {
    const installed = isEngineInstalled(id, spawnSync);
    engineChecks.set(id, installed);
    console.log(`  ${engineManifest[id].label}: ${installed ? "instalado" : "não instalado"}`);
  }

  async function step(label, action) {
    console.log(`\n→ ${label}`);
    try {
      const result = await action();
      if (dryRun && result !== "reused") console.log("  Seria instalado; nenhuma alteração ou validação foi executada.");
      else console.log(`  ${result === "reused" ? "Já estava instalado; etapa ignorada." : "Instalação verificada."}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ label, message });
      console.log(`  Pendente: ${message}`);
      console.log("  A próxima ferramenta continuará normalmente.");
    }
  }

  await step("Gerenciador Python uv", async () => {
    if (commandWorks("uv")) return "reused";
    await ensureUv(dryRun);
    return "installed";
  });

  for (const [packageId, label] of systemTools) {
    await step(label, () => installWinget(packageId, label, dryRun));
  }

  for (const id of engines) {
    await step(engineManifest[id].label, async () => {
      try {
        const result = await ensureEngine(id, dryRun, engineChecks.get(id));
        state.engines[id] = {
          installed: result === "installed" || result === "reused",
          checkedAt: new Date().toISOString(),
          environment: engineEnvDir(id),
        };
        if (!dryRun) writeVoiceLabState(state);
        return result;
      } catch (error) {
        state.engines[id] = {
          installed: false,
          checkedAt: new Date().toISOString(),
          environment: engineEnvDir(id),
          error: error instanceof Error ? error.message : String(error),
        };
        if (!dryRun) writeVoiceLabState(state);
        throw error;
      }
    });
  }

  if (!dryRun) {
    state.completedAt = new Date().toISOString();
    state.failures = failures;
    writeVoiceLabState(state);
  }

  console.log(dryRun ? "\nPrévia concluída; nada foi alterado." : "\nInstalação sequencial concluída.");
  if (failures.length) {
    console.log(`${failures.length} ferramenta(s) permaneceram pendentes:`);
    for (const failure of failures) console.log(`  - ${failure.label}: ${failure.message}`);
  } else if (!dryRun) {
    console.log("Todas as ferramentas foram instaladas e verificadas.");
  } else {
    console.log("Use o comando sem `--dry-run` para instalar e validar o que foi listado como ausente.");
  }
  console.log("Use `npm run companion` para inicializar o Voice Lab sem carregar modelos pesados.\n");
  return { failures, engines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSetupWizard().then(({ failures }) => {
    if (failures.length) process.exitCode = 1;
  }).catch((error) => {
    if (error?.code === "ABORT_ERR") {
      console.log("\nInstalação cancelada pelo usuário. Nenhum servidor foi iniciado.");
      process.exitCode = 130;
      return;
    }
    console.error(`\nFalha no instalador: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
