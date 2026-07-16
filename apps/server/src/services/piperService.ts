import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { appConfig, rootDir, voiceLabHome } from "../config.js";
import { AppError } from "../errors.js";
import { requireService } from "./capabilityService.js";

const piperVoices = [
  { id: "pt_BR-cadu-medium", name: "Cadu", quality: "medium", language: "Português do Brasil" },
  { id: "pt_BR-edresson-low", name: "Edresson", quality: "low", language: "Português do Brasil" },
  { id: "pt_BR-faber-medium", name: "Faber", quality: "medium", language: "Português do Brasil" },
  { id: "pt_BR-jeff-medium", name: "Jeff", quality: "medium", language: "Português do Brasil" },
] as const;

const downloadJobs = new Map<string, Promise<void>>();
const voiceDirectory = resolve(voiceLabHome, "models", "piper");

function voiceDefinition(id: string) {
  const voice = piperVoices.find((candidate) => candidate.id === id);
  if (!voice) {
    throw new AppError(422, "PIPER_VOICE_INVALID", "Selecione uma voz reconhecida no catálogo do Piper.");
  }
  return voice;
}

function voiceModelPath(id: string) {
  return resolve(voiceDirectory, `${id}.onnx`);
}

export function listPiperVoices() {
  return {
    source: "rhasspy/piper-voices",
    voices: piperVoices.map((voice) => ({
      ...voice,
      installed: existsSync(voiceModelPath(voice.id)) && existsSync(`${voiceModelPath(voice.id)}.json`),
    })),
  };
}

function piperPython() {
  return process.platform === "win32"
    ? resolve(voiceLabHome, "envs", "piper", "Scripts", "python.exe")
    : resolve(voiceLabHome, "envs", "piper", "bin", "python");
}

async function downloadVoice(id: string) {
  const python = piperPython();
  if (!existsSync(python)) {
    throw new AppError(503, "PIPER_ENVIRONMENT_MISSING", "O ambiente local do Piper não foi encontrado.", "Execute npm run setup uma vez e tente novamente.");
  }
  await mkdir(voiceDirectory, { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    const process = spawn(python, ["-m", "piper.download_voices", id, "--data-dir", voiceDirectory], { windowsHide: true });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    process.once("error", () => reject(new AppError(503, "PIPER_DOWNLOAD_START_ERROR", "Não foi possível iniciar o downloader de vozes do Piper.")));
    process.once("close", (code) => code === 0
      ? resolvePromise()
      : reject(new AppError(502, "PIPER_VOICE_DOWNLOAD_ERROR", stderr.trim() || `Downloader encerrou com código ${code}.`)));
  });
}

export async function preparePiperVoice(id: string) {
  const voice = voiceDefinition(id);
  const modelPath = voiceModelPath(voice.id);
  if (existsSync(modelPath) && existsSync(`${modelPath}.json`)) return { ...voice, installed: true, downloaded: false };
  let job = downloadJobs.get(voice.id);
  if (!job) {
    job = downloadVoice(voice.id).finally(() => downloadJobs.delete(voice.id));
    downloadJobs.set(voice.id, job);
  }
  await job;
  if (!existsSync(modelPath) || !existsSync(`${modelPath}.json`)) {
    throw new AppError(500, "PIPER_VOICE_FILES_MISSING", "O downloader terminou, mas os arquivos ONNX/JSON não foram encontrados.");
  }
  return { ...voice, installed: true, downloaded: true };
}

export async function synthesizePiper(text: string, speed = 1, voiceId = "pt_BR-faber-medium") {
  requireService("piper");
  if (!text.trim()) throw new AppError(400, "TEXT_REQUIRED", "Informe o texto para o Piper.");
  const voice = voiceDefinition(voiceId);
  const model = voiceModelPath(voice.id);
  if (!existsSync(model) || !existsSync(`${model}.json`)) {
    throw new AppError(409, "PIPER_VOICE_NOT_PREPARED", `A voz ${voice.name} ainda não foi baixada.`, "Clique em Preparar voz e aguarde a confirmação antes de gerar o áudio.");
  }
  const output = resolve(rootDir, "temp", "outputs", `${randomUUID()}.wav`);
  const lengthScale = String(Math.max(0.5, Math.min(2, 1 / speed)));
  return new Promise<{ audio: Buffer; contentType: string }>((resolvePromise, reject) => {
    const process = spawn(appConfig.services.piper.binary, [
      "-m", model,
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
