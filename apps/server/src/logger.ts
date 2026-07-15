import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { appConfig } from "./config.js";
import type { LogEntry } from "./types.js";

const entries: LogEntry[] = [];

function scrub(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value, (key, item) => {
    if (/authorization|api.?key|token|audio|file|buffer/i.test(key)) return "[redacted]";
    if (typeof item === "string" && item.length > 240) return `${item.slice(0, 240)}…`;
    return item;
  });
  return text?.slice(0, 600);
}

export function addLog(entry: Omit<LogEntry, "id" | "timestamp">) {
  entries.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), ...entry });
  entries.splice(appConfig.logLimit);
}

export function getLogs() {
  return entries;
}

export function clearLogs() {
  entries.length = 0;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => addLog({
    level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    category: "http",
    message: `${req.method} ${req.path} → ${res.statusCode}`,
    requestId,
    method: req.method,
    path: req.path,
    durationMs: Math.round(performance.now() - started),
    payloadSummary: scrub(req.body),
  }));
  next();
}
