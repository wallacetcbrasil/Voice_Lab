import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDir } from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const companionEntry = join(root, "scripts", "companion.mjs");

function companionAddress() {
  const port = Number(process.env.PORT || 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
  }
  return { port, url: `http://127.0.0.1:${port}` };
}

async function online(url, timeout = 1_000) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startCompanionInBackground(forwardedArgs = []) {
  const { url } = companionAddress();
  if (await online(`${url}/`)) {
    console.log(`O Voice Lab já está inicializado em ${url}`);
    return;
  }

  mkdirSync(runtimeDir(), { recursive: true });
  const logPath = join(runtimeDir(), "companion.log");
  const log = openSync(logPath, "w");
  const child = spawn(process.execPath, [companionEntry, ...forwardedArgs], {
    cwd: root,
    detached: true,
    env: { ...process.env, VOICE_LAB_BACKGROUND: "1" },
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  closeSync(log);

  console.log("Inicializando o Companion e validando os bridges instalados...");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await online(`${url}/`)) {
      console.log(`Voice Lab inicializado: ${url}`);
      console.log("O serviço permanece ativo em segundo plano; este terminal pode ser fechado.");
      console.log("Use `voice-lab stop` para encerrar e `voice-lab status` para verificar.");
      console.log(`Logs desta inicialização: ${logPath}`);
      return;
    }
    if (!processAlive(child.pid)) {
      throw new Error(`O Companion encerrou durante a inicialização. Consulte ${logPath}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  if (processAlive(child.pid)) process.kill(child.pid, "SIGTERM");
  throw new Error(`Tempo esgotado aguardando ${url}. Consulte ${logPath}`);
}

