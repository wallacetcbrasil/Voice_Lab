#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  engineManifest,
  enginePython,
  isEngineInstalled,
  readVoiceLabState,
  readRuntimePid,
  resolveExecutable,
  runtimeDir,
  runtimePidPath,
  voiceLabHome,
  writeRuntimePid,
} from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [action = "status", runtime = "all"] = process.argv.slice(2).filter((value) => !value.startsWith("--"));

function option(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function online(url, timeout = 2_000) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok; } catch { return false; }
}

function commandExists(command) {
  return Boolean(resolveExecutable(command));
}

function run(command, args, { allowFailure = false } = {}) {
  const executable = resolveExecutable(command) || command;
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (!allowFailure && result.status !== 0) throw new Error(`${command} terminou com código ${result.status}.`);
  return result.status === 0;
}

function processAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function stopLlama({ allowExternal = false } = {}) {
  const record = readRuntimePid("llama");
  if (record?.pid && processAlive(record.pid)) {
    process.kill(record.pid, "SIGTERM");
    for (let index = 0; index < 30 && await online("http://127.0.0.1:8080/health", 500); index++) await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    rmSync(runtimePidPath("llama"), { force: true });
    console.log("llama.cpp gerenciado pelo Voice Lab foi encerrado.");
    return;
  }
  if (await online("http://127.0.0.1:8080/health")) {
    if (allowExternal) throw new Error("Há um llama-server externo na porta 8080. Encerre-o no terminal que o iniciou.");
    throw new Error("O llama-server online não foi iniciado pelo Voice Lab; ele não será encerrado à força.");
  }
  rmSync(runtimePidPath("llama"), { force: true });
  console.log("llama.cpp já estava parado.");
}

async function stopLmStudio() {
  if (!commandExists("lms")) throw new Error("CLI `lms` não encontrada. Instale/abra o LM Studio uma vez.");
  run("lms", ["unload", "--all"], { allowFailure: true });
  run("lms", ["server", "stop"], { allowFailure: true });
  for (let index = 0; index < 20 && await online("http://127.0.0.1:1234/v1/models", 500); index += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (await online("http://127.0.0.1:1234/v1/models", 750)) {
    throw new Error("A API do LM Studio continuou online após a solicitação de parada. Encerre o servidor pelo LM Studio antes de iniciar o llama.cpp.");
  }
  console.log("Modelos do LM Studio descarregados e servidor local parado.");
}

async function startLmStudio() {
  if (await online("http://127.0.0.1:8080/health")) await stopLlama({ allowExternal: true });
  if (!commandExists("lms")) throw new Error("CLI `lms` não encontrada. Execute o LM Studio uma vez após a instalação.");
  run("lms", ["server", "start"]);
  console.log("LM Studio inicializado sem carregar modelo. Escolha o modelo no laboratório antes do teste.");
}

async function startLlama() {
  if (!commandExists("llama-server")) throw new Error("`llama-server` não encontrado. Execute primeiro `npm run setup`.");
  const hf = option("hf") || "ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(hf)) throw new Error("Referência Hugging Face inválida. Informe também a quantização após dois-pontos.");
  if (await online("http://127.0.0.1:1234/v1/models")) {
    if (!commandExists("lms")) {
      throw new Error("A API do LM Studio está online, mas a CLI `lms` não foi encontrada. Pare o servidor no LM Studio antes de iniciar o llama.cpp.");
    }
    await stopLmStudio();
  }
  if (await online("http://127.0.0.1:8080/health")) {
    console.log("llama.cpp já está inicializado em http://127.0.0.1:8080");
    return;
  }

  mkdirSync(runtimeDir(), { recursive: true });
  const logPath = join(runtimeDir(), "llama.log");
  const log = openSync(logPath, "a");
  const llamaServer = resolveExecutable("llama-server");
  const child = spawn(llamaServer, ["-hf", hf, "--host", "127.0.0.1", "--port", "8080"], {
    cwd: voiceLabHome,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  closeSync(log);
  writeRuntimePid("llama", { pid: child.pid, hf, startedAt: new Date().toISOString(), logPath });
  console.log(`llama.cpp iniciado com ${hf}. O download pode ocorrer na primeira execução.`);
  for (let index = 0; index < 180; index++) {
    if (await online("http://127.0.0.1:8080/health", 1_000)) {
      console.log("llama.cpp pronto em http://127.0.0.1:8080/v1");
      return;
    }
    if (!processAlive(child.pid)) throw new Error(`llama-server encerrou. Consulte ${logPath}`);
    if (index > 0 && index % 10 === 0) console.log("Aguardando download/carregamento do GGUF...");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`Tempo esgotado aguardando llama.cpp. Consulte ${logPath}`);
}

function stopCompanion() {
  const record = readRuntimePid("companion");
  for (const child of record?.children || []) {
    if (processAlive(child.pid)) process.kill(child.pid, "SIGTERM");
  }
  if (record?.pid && processAlive(record.pid)) process.kill(record.pid, "SIGTERM");
  rmSync(runtimePidPath("companion"), { force: true });
  console.log("Companion e bridges gerenciados foram encerrados.");
}

async function status() {
  const stage = (installed, initialized) => !installed ? "não instalado" : initialized ? "inicializado" : "instalado, ainda não inicializado";
  const companionOnline = await online("http://127.0.0.1:3333/");
  const lmInstalled = commandExists("lms");
  const llamaInstalled = commandExists("llama-server");
  const setupState = readVoiceLabState();
  console.log("Voice Lab — estado verificado\n");
  console.log(`Companion: ${stage(true, companionOnline)}`);
  console.log(`LM Studio: ${stage(lmInstalled, await online("http://127.0.0.1:1234/v1/models"))}`);
  console.log(`llama.cpp: ${stage(llamaInstalled, await online("http://127.0.0.1:8080/health"))}`);
  for (const [id, manifest] of Object.entries(engineManifest)) {
    const recorded = setupState.engines?.[id];
    const installed = recorded?.installed === true && existsSync(enginePython(id))
      ? true
      : isEngineInstalled(id, spawnSync);
    const initialized = installed && (manifest.port
      ? await online(`http://127.0.0.1:${manifest.port}/health`)
      : companionOnline);
    console.log(`${manifest.label}: ${stage(installed, initialized)}`);
  }
  console.log("\nModelos são verificados separadamente no laboratório correspondente e não são carregados pelo status.");
}

try {
  if (action === "status") await status();
  else if (action === "start" && runtime === "lmstudio") await startLmStudio();
  else if (action === "start" && runtime === "llama") await startLlama();
  else if (action === "stop" && runtime === "lmstudio") await stopLmStudio();
  else if (action === "stop" && runtime === "llama") await stopLlama();
  else if (action === "stop" && runtime === "companion") stopCompanion();
  else if (action === "stop" && runtime === "all") {
    const errors = [];
    for (const stop of [() => stopLlama(), () => stopLmStudio(), () => stopCompanion()]) {
      try { await stop(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (errors.length) throw new Error(errors.join(" "));
  }
  else throw new Error("Uso: voice-lab-runtime status | start lmstudio | start llama [--hf=org/repo:quant] | stop lmstudio|llama|companion|all");
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
