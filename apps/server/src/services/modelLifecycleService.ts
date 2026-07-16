import { AppError } from "../errors.js";
import { pythonModelControl, type PythonBridgeEngine } from "./pythonBridge.js";

export const loadablePythonEngines = ["kokoro", "whisper", "xtts", "openvoice", "transformers"] as const;
export type LoadablePythonEngine = typeof loadablePythonEngines[number];

export function parseLoadablePythonEngine(value: unknown): LoadablePythonEngine {
  const engine = String(value || "");
  if (!loadablePythonEngines.includes(engine as LoadablePythonEngine)) {
    throw new AppError(400, "MODEL_ENGINE_INVALID", "Este motor não oferece carregamento explícito de checkpoint.", `Motores aceitos: ${loadablePythonEngines.join(", ")}.`);
  }
  return engine as LoadablePythonEngine;
}

export async function pythonModelStatus(engineValue: unknown, options: Record<string, unknown> = {}) {
  const engine = parseLoadablePythonEngine(engineValue);
  return pythonModelControl(engine as PythonBridgeEngine, "/api/models/status", { engine, options });
}

export async function loadPythonModel(engineValue: unknown, options: Record<string, unknown> = {}) {
  const engine = parseLoadablePythonEngine(engineValue);
  return pythonModelControl(engine as PythonBridgeEngine, "/api/models/load", { engine, options });
}
