import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const home = mkdtempSync(join(tmpdir(), "voice-lab-lifecycle-"));
let port = 0;

async function availablePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(selected));
    });
  });
}

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      VOICE_LAB_HOME: home,
    },
  });
}

async function online() {
  try {
    return (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

afterAll(async () => {
  if (port) run("scripts/runtime.mjs", ["stop", "companion"]);
  rmSync(home, { recursive: true, force: true });
});
describe("Companion CLI lifecycle", () => {
  it("keeps the background Companion alive after the start command returns", async () => {
    port = await availablePort();
    const started = run("scripts/cli.mjs", ["start", "--no-python"]);

    expect(started.status, `${started.stdout}\n${started.stderr}`).toBe(0);
    expect(started.stdout).toContain("permanece ativo em segundo plano");
    expect(await online()).toBe(true);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
    expect(await online()).toBe(true);

    const stopped = run("scripts/runtime.mjs", ["stop", "companion"]);
    expect(stopped.status, `${stopped.stdout}\n${stopped.stderr}`).toBe(0);

    for (let attempt = 0; attempt < 20 && await online(); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    expect(await online()).toBe(false);
  }, 40_000);
});
