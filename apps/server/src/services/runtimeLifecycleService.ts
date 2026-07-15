import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { appConfig, rootDir } from "../config.js";
import { AppError } from "../errors.js";
import { diagnoseLlamaCpp } from "./llamaCppService.js";

const execFileAsync = promisify(execFile);
const runtimeScript = resolve(rootDir, "scripts", "runtime.mjs");
const hfReferencePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
let llamaOperation: Promise<LlamaRuntimeResult> | null = null;

export interface LlamaRuntimeResult {
  action: "start" | "stop";
  commandOutput: string;
  lmStudioOnline: boolean;
  diagnosis: Awaited<ReturnType<typeof diagnoseLlamaCpp>>;
}

export function validateLlamaHfReference(value: unknown) {
  const reference = String(value || "").trim();
  if (!hfReferencePattern.test(reference)) {
    throw new AppError(
      400,
      "LLAMA_MODEL_REFERENCE_INVALID",
      "Informe uma referência Hugging Face no formato organização/repositório:quantização.",
      "Exemplo: ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M.",
    );
  }
  return reference;
}

async function isLmStudioOnline() {
  try {
    return (await fetch(`${new URL(appConfig.lmStudioBaseUrl).origin}/v1/models`, {
      signal: AbortSignal.timeout(2_000),
    })).ok;
  } catch {
    return false;
  }
}

async function executeRuntime(action: "start" | "stop", hf?: string): Promise<LlamaRuntimeResult> {
  const args = [runtimeScript, action, "llama"];
  if (action === "start" && hf) args.push(`--hf=${hf}`);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: rootDir,
      windowsHide: true,
      timeout: appConfig.modelLoadTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const diagnosis = await diagnoseLlamaCpp(appConfig.llamaCppBaseUrl);
    const lmStudioOnline = await isLmStudioOnline();
    if (action === "start" && lmStudioOnline) {
      throw new AppError(
        409,
        "RUNTIME_CONFLICT",
        "O llama.cpp foi solicitado, mas a API do LM Studio continua online.",
        "Pare o servidor no LM Studio e tente novamente; o Voice Lab não mantém os dois runtimes ativos.",
      );
    }
    if (action === "start" && !diagnosis.serverOnline) {
      throw new AppError(502, "LLAMA_START_NOT_VERIFIED", "O processo terminou sem disponibilizar o endpoint do llama.cpp.", diagnosis.diagnosis);
    }
    return {
      action,
      commandOutput: [stdout, stderr].filter(Boolean).join("\n").trim(),
      lmStudioOnline,
      diagnosis,
    };
  } catch (caught) {
    if (action === "start") {
      await execFileAsync(process.execPath, [runtimeScript, "stop", "llama"], {
        cwd: rootDir,
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 256 * 1024,
      }).catch(() => undefined);
    }
    if (caught instanceof AppError) throw caught;
    const error = caught as Error & { stderr?: string; killed?: boolean; code?: string };
    const timedOut = error.killed || error.code === "ETIMEDOUT";
    const detail = String(error.stderr || error.message).replace(/^Erro:\s*/i, "").trim();
    throw new AppError(
      timedOut ? 504 : 409,
      timedOut ? "LLAMA_START_TIMEOUT" : "LLAMA_LIFECYCLE_FAILED",
      detail || `Não foi possível ${action === "start" ? "iniciar" : "encerrar"} o llama.cpp.`,
      action === "start"
        ? "Confira a instalação, a referência do modelo e o log em AppData/Local/VoiceLab/runtime/llama.log."
        : "Se o servidor foi aberto manualmente, encerre-o no terminal que o iniciou.",
    );
  }
}

function serializeLlamaOperation(operation: () => Promise<LlamaRuntimeResult>) {
  if (llamaOperation) return llamaOperation;
  llamaOperation = operation().finally(() => { llamaOperation = null; });
  return llamaOperation;
}

export function startManagedLlama(hf: unknown) {
  const reference = validateLlamaHfReference(hf);
  return serializeLlamaOperation(() => executeRuntime("start", reference));
}

export function stopManagedLlama() {
  return serializeLlamaOperation(() => executeRuntime("stop"));
}
