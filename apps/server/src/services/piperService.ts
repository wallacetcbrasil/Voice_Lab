import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { appConfig, rootDir } from "../config.js";
import { AppError } from "../errors.js";
import { requireService } from "./capabilityService.js";

export async function synthesizePiper(text: string, speed = 1) {
  requireService("piper");
  if (!text.trim()) throw new AppError(400, "TEXT_REQUIRED", "Informe o texto para o Piper.");
  const output = resolve(rootDir, "temp", "outputs", `${randomUUID()}.wav`);
  const lengthScale = String(Math.max(0.5, Math.min(2, 1 / speed)));
  return new Promise<{ audio: Buffer; contentType: string }>((resolvePromise, reject) => {
    const process = spawn(appConfig.services.piper.binary, [
      "-m", appConfig.services.piper.model,
      "-f", output,
      "--length-scale", lengthScale,
      "--", text,
    ], { windowsHide: true });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    process.on("error", async () => {
      await rm(output, { force: true });
      reject(new AppError(503, "PIPER_START_ERROR", "Não foi possível iniciar o Piper.", "Confira a instalação do Piper na tela Instalação e Diagnóstico."));
    });
    process.on("close", async (code) => {
      try {
        if (code !== 0) throw new AppError(500, "PIPER_GENERATION_ERROR", stderr || `Piper encerrou com código ${code}.`);
        const audio = await readFile(output);
        resolvePromise({ audio, contentType: "audio/wav" });
      } catch (error) {
        reject(error instanceof AppError
          ? error
          : new AppError(500, "PIPER_OUTPUT_ERROR", "O Piper não gerou um WAV legível."));
      } finally {
        await rm(output, { force: true });
      }
    });
    process.stdin.end();
  });
}
