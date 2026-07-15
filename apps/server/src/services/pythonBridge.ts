import { appConfig } from "../config.js";
import { AppError } from "../errors.js";

export type PythonBridgeEngine = keyof typeof appConfig.pythonBaseUrls;
const internalTokenHeader = "x-voice-lab-internal-token";

export function pythonBridgeAuthHeaders(required = true): Record<string, string> {
  const token = process.env.VOICE_LAB_INTERNAL_TOKEN;
  if (!token && required) {
    throw new AppError(
      503,
      "PYTHON_BRIDGE_AUTH_NOT_CONFIGURED",
      "O pareamento interno dos bridges Python não foi configurado.",
      "Inicie os motores com o Voice Lab Companion em vez de abrir o Uvicorn manualmente.",
    );
  }
  return token ? { [internalTokenHeader]: token } : {};
}

function bridgeBaseUrl(engine: PythonBridgeEngine) {
  return appConfig.pythonBaseUrls[engine].replace(/\/$/, "");
}

function bridgeError(error: unknown, engine: PythonBridgeEngine) {
  if (error instanceof AppError) return error;
  const baseUrl = bridgeBaseUrl(engine);
  return new AppError(
    503,
    "PYTHON_BACKEND_OFFLINE",
    `O bridge Python de ${engine} não respondeu em ${baseUrl}.`,
    "Inicie o Voice Lab Companion; ele abre somente os bridges Python instalados e mantém os modelos pesados sob demanda.",
  );
}

function resolveJsonArguments(
  engineOrEndpoint: PythonBridgeEngine | string,
  endpointOrBody: string | unknown,
  possibleBody?: unknown,
) {
  const legacyCall = String(engineOrEndpoint).startsWith("/");
  return legacyCall
    ? { engine: "bridge" as const, endpoint: String(engineOrEndpoint), body: endpointOrBody }
    : { engine: engineOrEndpoint as PythonBridgeEngine, endpoint: String(endpointOrBody), body: possibleBody };
}

export function pythonJson(engine: PythonBridgeEngine, endpoint: string, body: unknown): Promise<{ audio?: Buffer; contentType?: string; json?: unknown }>;
/** @deprecated Informe o engine explicitamente. Esta assinatura usa o bridge base na porta 8000. */
export function pythonJson(endpoint: string, body: unknown): Promise<{ audio?: Buffer; contentType?: string; json?: unknown }>;
export async function pythonJson(engineOrEndpoint: PythonBridgeEngine | string, endpointOrBody: string | unknown, possibleBody?: unknown) {
  const { engine, endpoint, body } = resolveJsonArguments(engineOrEndpoint, endpointOrBody, possibleBody);
  try {
    const response = await fetch(`${bridgeBaseUrl(engine)}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...pythonBridgeAuthHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(appConfig.timeoutMs),
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; hint?: string } };
      throw new AppError(
        response.status,
        data.error?.code || "PYTHON_SERVICE_ERROR",
        data.error?.message || `Backend Python respondeu HTTP ${response.status}.`,
        data.error?.hint,
      );
    }
    if (type.startsWith("audio/")) return { audio: Buffer.from(await response.arrayBuffer()), contentType: type };
    return { json: await response.json() };
  } catch (error) {
    throw bridgeError(error, engine);
  }
}

function resolveMultipartArguments(
  engineOrEndpoint: PythonBridgeEngine | string,
  endpointOrFields: string | Record<string, string>,
  fieldsOrFile?: Record<string, string> | Express.Multer.File,
  possibleFile?: Express.Multer.File,
) {
  const legacyCall = String(engineOrEndpoint).startsWith("/");
  return legacyCall
    ? {
        engine: "bridge" as const,
        endpoint: String(engineOrEndpoint),
        fields: endpointOrFields as Record<string, string>,
        file: fieldsOrFile as Express.Multer.File | undefined,
      }
    : {
        engine: engineOrEndpoint as PythonBridgeEngine,
        endpoint: String(endpointOrFields),
        fields: fieldsOrFile as Record<string, string>,
        file: possibleFile,
      };
}

export function pythonMultipart(engine: PythonBridgeEngine, endpoint: string, fields: Record<string, string>, file?: Express.Multer.File): Promise<{ audio?: Buffer; contentType?: string; json?: unknown }>;
/** @deprecated Informe o engine explicitamente. Esta assinatura usa o bridge base na porta 8000. */
export function pythonMultipart(endpoint: string, fields: Record<string, string>, file?: Express.Multer.File): Promise<{ audio?: Buffer; contentType?: string; json?: unknown }>;
export async function pythonMultipart(
  engineOrEndpoint: PythonBridgeEngine | string,
  endpointOrFields: string | Record<string, string>,
  fieldsOrFile?: Record<string, string> | Express.Multer.File,
  possibleFile?: Express.Multer.File,
) {
  const { engine, endpoint, fields, file } = resolveMultipartArguments(engineOrEndpoint, endpointOrFields, fieldsOrFile, possibleFile);
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  if (file) {
    const bytes = new Uint8Array(file.buffer.byteLength);
    bytes.set(file.buffer);
    form.append("audio", new Blob([bytes.buffer], { type: file.mimetype }), file.originalname);
  }
  try {
    const response = await fetch(`${bridgeBaseUrl(engine)}${endpoint}`, {
      method: "POST",
      headers: pythonBridgeAuthHeaders(),
      body: form,
      signal: AbortSignal.timeout(appConfig.timeoutMs),
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; hint?: string } };
      throw new AppError(
        response.status,
        data.error?.code || "PYTHON_SERVICE_ERROR",
        data.error?.message || `Backend Python respondeu HTTP ${response.status}.`,
        data.error?.hint,
      );
    }
    if (type.startsWith("audio/")) return { audio: Buffer.from(await response.arrayBuffer()), contentType: type };
    return { json: await response.json() };
  } catch (error) {
    throw bridgeError(error, engine);
  }
}
