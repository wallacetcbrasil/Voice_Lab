import type { ApiFailure } from "../types";

const LOOPBACK_COMPANION = "http://127.0.0.1:3333";
const STORAGE_KEY = "voice-lab-companion-url";
const TOKEN_KEY = "voice-lab-companion-token";

function isLocalFrontend() {
  return ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
}

export function getCompanionBaseUrl() {
  const configured = localStorage.getItem(STORAGE_KEY)?.trim() || import.meta.env.VITE_COMPANION_URL?.trim();
  return (configured || (isLocalFrontend() ? "" : LOOPBACK_COMPANION)).replace(/\/$/, "");
}

export function setCompanionBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/$/, "");
  if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
  else localStorage.removeItem(STORAGE_KEY);
}

export function companionApiUrl(path: string) {
  return `${getCompanionBaseUrl()}${path}`;
}

export function companionWebSocketUrl(path: string) {
  const base = getCompanionBaseUrl() || location.origin;
  const separator = path.includes("?") ? "&" : "?";
  const token = sessionStorage.getItem(TOKEN_KEY) || "";
  return `${base.replace(/^http/, "ws")}${path}${separator}token=${encodeURIComponent(token)}`;
}

type LoopbackRequestInit = RequestInit & { targetAddressSpace?: "loopback" };

function loopbackInit(init: RequestInit = {}): LoopbackRequestInit {
  const requestInit: LoopbackRequestInit = { ...init, mode: "cors" };
  if (getCompanionBaseUrl().startsWith("http://127.0.0.1")) requestInit.targetAddressSpace = "loopback";
  return requestInit;
}

async function pairWithCompanion() {
  const response = await fetch(companionApiUrl("/api/pair"), loopbackInit({ method: "POST" }));
  const payload = await response.json().catch(() => undefined) as { data?: { token?: string }; error?: { message?: string } } | undefined;
  if (!response.ok || !payload?.data?.token) throw new ApiError("PAIRING_FAILED", payload?.error?.message || "Não foi possível parear com o companion local.", "Mantenha o companion aberto e verifique a origem autorizada.", response.status);
  sessionStorage.setItem(TOKEN_KEY, payload.data.token);
  return payload.data.token;
}

async function companionToken() {
  return sessionStorage.getItem(TOKEN_KEY) || pairWithCompanion();
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public hint?: string, public status?: number) {
    super(message);
  }
}

async function decode(response: Response) {
  const type = response.headers.get("content-type") || "";
  if (type.startsWith("audio/")) return new Blob([await response.arrayBuffer()], { type });
  const data = await response.json().catch(() => ({ ok: false, error: { code: "INVALID_RESPONSE", message: "Resposta inválida do backend." } }));
  if (!response.ok || data.ok === false) {
    const failure = data as ApiFailure;
    throw new ApiError(failure.error?.code || "REQUEST_FAILED", failure.error?.message || `HTTP ${response.status}`, failure.error?.hint, response.status);
  }
  return data;
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("x-voice-lab-token", await companionToken());
  const requestInit = loopbackInit({ ...init, headers });
  let response = await fetch(companionApiUrl(path), requestInit);
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    headers.set("x-voice-lab-token", await pairWithCompanion());
    response = await fetch(companionApiUrl(path), loopbackInit({ ...init, headers }));
  }
  return decode(response) as Promise<T>;
}

export const postJson = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

export async function streamChat(body: unknown, onToken: (token: string) => void, options: { signal?: AbortSignal } = {}) {
  const requestInit = loopbackInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-voice-lab-token": await companionToken() },
    body: JSON.stringify({ ...(body as object), stream: true }),
    signal: options.signal,
  });
  const response = await fetch(companionApiUrl("/api/lmstudio/chat"), requestInit);
  if (!response.ok || !response.body) await decode(response);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const chunk = JSON.parse(raw);
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch {
        // Ignore keep-alives or runtime-specific non-JSON fields.
      }
    }
  }
}

export function playBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  void audio.play();
  return { audio, url };
}
