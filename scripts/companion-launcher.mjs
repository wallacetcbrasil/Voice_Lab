import { spawn } from "node:child_process";
import { mkdirSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDir } from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const detachEntry = join(root, "scripts", "companion-detach.mjs");

function printLine(message) {
  try {
    writeSync(process.stdout.fd, `${message}\n`);
  } catch {
    console.log(message);
  }
}

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

export async function startCompanionInBackground(forwardedArgs = []) {
  const { url } = companionAddress();
  if (await online(`${url}/`)) {
    printLine(`O Voice Lab já está inicializado em ${url}`);
    return;
  }

  printLine(`Voice Lab Companion: ${url}`);
  printLine("Inicializando e validando os bridges instalados; nenhum modelo pesado será carregado.");

  mkdirSync(runtimeDir(), { recursive: true });
  const logPath = join(runtimeDir(), "companion.log");
  await new Promise((resolvePromise, reject) => {
    const launcher = spawn(process.execPath, [detachEntry, ...forwardedArgs], {
      cwd: root,
      env: { ...process.env, VOICE_LAB_BACKGROUND: "1" },
      windowsHide: true,
      stdio: "ignore",
    });
    launcher.once("error", reject);
    launcher.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`O launcher interno encerrou com código ${code}.`)));
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await online(`${url}/`)) {
      printLine(`Voice Lab inicializado: ${url}`);
      printLine("O serviço permanece ativo em segundo plano; este terminal pode ser fechado.");
      printLine("Use `voice-lab stop` para encerrar e `voice-lab status` para verificar.");
      printLine(`Logs desta inicialização: ${logPath}`);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`Tempo esgotado aguardando ${url}. Consulte ${logPath}`);
}
