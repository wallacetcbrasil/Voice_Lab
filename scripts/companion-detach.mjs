#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDir } from "./runtime-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const companionEntry = join(root, "scripts", "companion.mjs");
mkdirSync(runtimeDir(), { recursive: true });
const log = openSync(join(runtimeDir(), "companion.log"), "w");

try {
  const child = spawn(process.execPath, [companionEntry, ...process.argv.slice(2)], {
    cwd: root,
    detached: true,
    env: { ...process.env, VOICE_LAB_BACKGROUND: "1" },
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  await new Promise((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  child.unref();
} finally {
  closeSync(log);
}
