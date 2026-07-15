#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSetupWizard } from "./setup-wizard.mjs";
import {
  engineManifest,
  enginePython,
  isEngineInstalled,
  readVoiceLabState,
  runtimePidPath,
  voiceLabHome,
  writeRuntimePid,
} from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Voice Lab Companion

Uso:
  voice-lab-setup       instala todas as ferramentas, sem iniciar modelos
  voice-lab-companion   inicia o site e os bridges já instalados
  voice-lab-companion --setup  instala o que falta e depois inicia
  voice-lab-companion --origin=https://seu-site.vercel.app

Aplicação: http://127.0.0.1:3333`);
  process.exit(0);
}

function configureWebOrigin() {
  if (args.has("--origin")) throw new Error("Use --origin=https://endereco-exato, com o valor no mesmo argumento.");
  const argument = process.argv.slice(2).find((value) => value.startsWith("--origin="));
  if (!argument) return undefined;
  const raw = argument.slice("--origin=".length).trim();
  if (!raw || raw.includes("*")) throw new Error("A origem deve ser uma URL exata, sem wildcard.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Origem inválida. Informe uma URL HTTPS ou uma origem loopback HTTP.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const protocolAllowed = url.protocol === "https:" || (loopback && url.protocol === "http:");
  if (!protocolAllowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("A origem deve conter somente protocolo, host e porta: HTTPS pública ou HTTP loopback.");
  }
  const configured = (process.env.WEB_ORIGINS || process.env.WEB_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  process.env.WEB_ORIGINS = [...new Set([...configured, url.origin])].join(",");
  return url.origin;
}

let requestedOrigin;
try {
  requestedOrigin = configureWebOrigin();
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

console.log("\nVoice Lab Companion");
console.log("Aplicação: http://127.0.0.1:3333");
console.log(args.has("--setup")
  ? "A instalação será concluída antes de iniciar os bridges."
  : "Iniciando o Companion; os bridges instalados serão validados em paralelo.");

const serverEntry = join(root, "apps", "server", "dist", "index.js");
if (!existsSync(serverEntry)) {
  console.error("O Companion não foi compilado. Execute npm run build neste checkout.");
  process.exit(1);
}

async function online(url, timeout = 1_200) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

if (args.has("--setup")) {
  try {
    await runSetupWizard();
  } catch (error) {
    if (error?.code === "ABORT_ERR") {
      console.log("\nInstalação cancelada. Nenhum serviço foi iniciado.");
      process.exit(130);
    }
    throw error;
  }
}

if (await online("http://127.0.0.1:3333/")) {
  if (requestedOrigin) {
    console.error("O Voice Lab já está inicializado, mas a origem informada não pode ser aplicada ao processo existente.");
    console.error("Execute `voice-lab stop` e inicie novamente com o mesmo `--origin=...`.");
    process.exit(1);
  }
  console.log("O Voice Lab já está inicializado em http://127.0.0.1:3333");
  console.log("Use `voice-lab-runtime stop companion` antes de iniciar outra instância.");
  process.exit(0);
}

const setupState = readVoiceLabState();
const installedBridges = Object.entries(engineManifest).filter(([id, manifest]) => {
  if (!manifest.port || args.has("--no-python")) return false;
  const recorded = setupState.engines?.[id];
  if (recorded) return recorded.installed === true && existsSync(enginePython(id));
  return isEngineInstalled(id, spawnSync);
});
const occupiedBridges = (await Promise.all(installedBridges.map(async ([, manifest]) => {
  const url = `http://127.0.0.1:${manifest.port}`;
  return await online(`${url}/health`) ? `${manifest.label} (${url})` : undefined;
}))).filter(Boolean);
if (occupiedBridges.length) {
  console.error("Não foi possível criar um pareamento interno novo porque existem bridges órfãos nas portas reservadas:");
  occupiedBridges.forEach((bridge) => console.error(`  - ${bridge}`));
  console.error("Encerre os processos anteriores com `voice-lab stop` e tente novamente.");
  process.exit(1);
}

const internalBridgeToken = randomBytes(32).toString("base64url");
process.env.VOICE_LAB_INTERNAL_TOKEN = internalBridgeToken;
const children = [];
const pythonUrls = {};
for (const [id, manifest] of installedBridges) {
  const url = `http://127.0.0.1:${manifest.port}`;
  pythonUrls[id] = url;
  const python = enginePython(id);
  const child = spawn(python, ["-m", "uvicorn", "python.app:app", "--app-dir", root, "--host", "127.0.0.1", "--port", String(manifest.port)], {
    cwd: root,
    env: {
      ...process.env,
      VOICE_LAB_ACTIVE_ENGINE: id,
      VOICE_LAB_HOME: voiceLabHome,
      VOICE_LAB_INTERNAL_TOKEN: internalBridgeToken,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push({ id, child });
  console.log(`${manifest.label}: inicializando bridge em ${url}`);
}

process.env.HOST = "127.0.0.1";
process.env.PYTHON_AUDIO_BASE_URL = pythonUrls.bridge || "http://127.0.0.1:8000";
process.env.PYTHON_KOKORO_BASE_URL = pythonUrls.kokoro || "http://127.0.0.1:8101";
process.env.PYTHON_WHISPER_BASE_URL = pythonUrls.whisper || "http://127.0.0.1:8102";
process.env.PYTHON_XTTS_BASE_URL = pythonUrls.xtts || "http://127.0.0.1:8103";
process.env.PYTHON_OPENVOICE_BASE_URL = pythonUrls.openvoice || "http://127.0.0.1:8104";
process.env.PYTHON_RVC_BASE_URL = pythonUrls.rvc || "http://127.0.0.1:8105";
process.env.PYTHON_TRANSFORMERS_BASE_URL = pythonUrls.transformers || "http://127.0.0.1:8106";
writeRuntimePid("companion", { pid: process.pid, startedAt: new Date().toISOString(), children: children.map(({ id, child }) => ({ id, pid: child.pid })) });

await import(pathToFileURL(serverEntry).href);

console.log("\nVoice Lab inicializado.");
console.log("Abra no navegador: http://127.0.0.1:3333");
if (requestedOrigin) console.log(`Origem pública autorizada nesta sessão: ${requestedOrigin}`);
console.log("Modelos pesados permanecem descarregados até a ação no laboratório correspondente.");
console.log("Pressione CTRL+C para encerrar o Companion e os bridges gerenciados.\n");

void Promise.all(children.map(async ({ id }) => {
  const manifest = engineManifest[id];
  const url = `http://127.0.0.1:${manifest.port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await online(`${url}/health`, 1_000)) {
      console.log(`${manifest.label}: bridge validado em ${url}`);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  console.error(`${manifest.label}: não respondeu em ${url}; consulte a saída do processo acima.`);
}));

function shutdown(signal) {
  for (const { child } of children) child.kill(signal);
  rmSync(runtimePidPath("companion"), { force: true });
}

process.on("SIGINT", () => { shutdown("SIGINT"); process.exit(0); });
process.on("SIGTERM", () => { shutdown("SIGTERM"); process.exit(0); });
