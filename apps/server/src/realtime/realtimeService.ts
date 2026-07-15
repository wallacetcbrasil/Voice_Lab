import { randomUUID } from "node:crypto";

export interface RealtimeSession {
  id: string;
  createdAt: string;
  status: "created" | "connected" | "closed";
  mode: "assistant" | "transport";
  chunksReceived: number;
  bytesReceived: number;
  lastActivityAt: string;
  chunkMs: number;
  connectedAt?: string;
  closedAt?: string;
}

const sessions = new Map<string, RealtimeSession>();

export function createSession(chunkMs = 500, mode: RealtimeSession["mode"] = "transport") {
  const normalizedChunkMs = [250, 500, 1_000].includes(chunkMs) ? chunkMs : 500;
  const session: RealtimeSession = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "created",
    mode,
    chunksReceived: 0,
    bytesReceived: 0,
    lastActivityAt: new Date().toISOString(),
    chunkMs: normalizedChunkMs,
  };
  sessions.set(session.id, session);
  return session;
}

export function connectSession(id: string) {
  const session = sessions.get(id);
  if (!session || session.status !== "created") return undefined;
  session.status = "connected";
  session.connectedAt = new Date().toISOString();
  session.lastActivityAt = session.connectedAt;
  return session;
}

export function registerChunk(id: string, bytes: number) {
  const session = sessions.get(id);
  if (!session || session.status !== "connected" || !Number.isSafeInteger(bytes) || bytes <= 0) return undefined;
  session.chunksReceived += 1;
  session.bytesReceived += bytes;
  session.lastActivityAt = new Date().toISOString();
  return session;
}

export function closeSession(id: string) {
  const session = sessions.get(id);
  if (session && session.status !== "closed") {
    session.status = "closed";
    session.closedAt = new Date().toISOString();
    session.lastActivityAt = session.closedAt;
  }
  return session;
}

export function realtimeStats() {
  const values = [...sessions.values()];
  return {
    sessions: values.length,
    created: values.filter((session) => session.status === "created").length,
    connected: values.filter((session) => session.status === "connected").length,
    closed: values.filter((session) => session.status === "closed").length,
  };
}
