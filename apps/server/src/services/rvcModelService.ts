import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { voiceLabHome } from "../config.js";
import { AppError } from "../errors.js";

const modelDirectory = resolve(voiceLabHome, "models", "rvc");

export async function listRvcModels() {
  await mkdir(modelDirectory, { recursive: true });
  const entries = await readdir(modelDirectory, { withFileTypes: true });
  const models = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pth"))
    .map(async (entry) => {
      const info = await stat(resolve(modelDirectory, entry.name));
      return { id: entry.name, name: entry.name.replace(/\.pth$/i, ""), size: info.size };
    }));
  return { directory: modelDirectory, models: models.sort((left, right) => left.name.localeCompare(right.name)) };
}

async function validateCheckpointHeader(path: string) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const zipArchive = bytesRead >= 2 && header[0] === 0x50 && header[1] === 0x4b;
    const pickle = bytesRead >= 2 && header[0] === 0x80 && header[1] >= 0x02;
    if (!zipArchive && !pickle) {
      throw new AppError(415, "RVC_CHECKPOINT_INVALID", "O arquivo não tem a estrutura inicial esperada de um checkpoint PyTorch.");
    }
  } finally {
    await handle.close();
  }
}

export async function importRvcModel(file: Express.Multer.File | undefined, consent: unknown, trusted: unknown) {
  if (!file?.path) throw new AppError(400, "RVC_MODEL_REQUIRED", "Selecione um checkpoint RVC .pth.");
  const original = basename(file.originalname);
  try {
    if (!(consent === true || consent === "true")) {
      throw new AppError(403, "VOICE_CONSENT_REQUIRED", "Use apenas vozes próprias ou autorizadas.");
    }
    if (!(trusted === true || trusted === "true")) {
      throw new AppError(403, "RVC_CHECKPOINT_TRUST_REQUIRED", "Confirme que o checkpoint é próprio ou vem de uma origem confiável.", "Arquivos .pth podem conter código Python; não importe modelos desconhecidos.");
    }
    if (!/^[\p{L}\p{N}_.() -]+\.pth$/iu.test(original)) {
      throw new AppError(415, "RVC_MODEL_NAME_INVALID", "Use um arquivo .pth com nome simples, sem caminhos ou caracteres de comando.");
    }
    await validateCheckpointHeader(file.path);
    await mkdir(modelDirectory, { recursive: true });
    const destination = resolve(modelDirectory, original);
    try {
      await copyFile(file.path, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AppError(409, "RVC_MODEL_ALREADY_EXISTS", `O modelo ${original} já está na biblioteca local.`);
      }
      throw error;
    }
    const info = await stat(destination);
    return { id: original, name: original.replace(/\.pth$/i, ""), size: info.size, imported: true };
  } finally {
    await rm(file.path, { force: true });
  }
}
