import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { assertLocalUrl } from "./lmStudioClient.js";
import { rootDir } from "../config.js";

const execFileAsync = promisify(execFile);

async function findBinary() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(command, ["llama-server"], { windowsHide: true, timeout: 4_000 });
    const found = stdout.split(/\r?\n/).find(Boolean)?.trim();
    if (found) return found;
  } catch {
    // Continue with fresh PATH and package-location discovery.
  }

  const executable = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const freshPathDirectories = new Set((process.env.PATH || "").split(delimiter).filter(Boolean));

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User')",
      ], { windowsHide: true, timeout: 4_000 });
      stdout.trim().split(delimiter).filter(Boolean).forEach((path) => freshPathDirectories.add(path));
    } catch {
      // Registry/user PATH lookup is best effort.
    }
  }

  for (const directory of freshPathDirectories) {
    const candidate = join(directory.trim(), executable);
    if (existsSync(candidate)) return candidate;
  }

  const candidates = [
    resolve(rootDir, "tools", "llama.cpp", "build", "bin", "Release", executable),
    join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", executable),
  ];

  if (process.platform === "win32") {
    const packagesDir = join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
    try {
      for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^ggml\.llamacpp_/i.test(entry.name)) {
          candidates.push(join(packagesDir, entry.name, executable));
        }
      }
    } catch {
      // Winget package directory may not exist.
    }
  }

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export async function diagnoseLlamaCpp(baseUrl: string) {
  const normalized = assertLocalUrl(baseUrl);
  const url = new URL(normalized);
  const origin = `${url.protocol}//${url.host}`;
  const binaryPath = await findBinary();
  let online = false;
  let health: unknown = null;
  let models: Array<{ id?: string }> = [];
  let connectionError = "";

  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_500) });
    online = response.ok;
    health = await response.json().catch(() => ({ status: response.status }));
  } catch (error) {
    connectionError = error instanceof Error ? error.message : "Servidor não respondeu.";
  }

  if (online) {
    try {
      const response = await fetch(`${normalized}/models`, { signal: AbortSignal.timeout(2_500) });
      const payload = await response.json() as { data?: Array<{ id?: string }> };
      models = payload.data || [];
    } catch {
      // Alguns builds antigos não expõem /v1/models, mas /health ainda prova o servidor.
    }
  }

  return {
    platform: process.platform,
    binaryFound: Boolean(binaryPath),
    binaryPath,
    serverOnline: online,
    baseUrl: normalized,
    health,
    models,
    connectionError,
    diagnosis: !binaryPath
      ? "llama-server não foi encontrado no PATH."
      : !online
        ? "llama.cpp está instalado, mas o llama-server não está rodando nesta URL."
        : models.length === 0
          ? "Servidor online, mas nenhum modelo foi anunciado. Confira o comando -m/--model."
          : "llama-server online e pronto para receber requisições.",
  };
}
