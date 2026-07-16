import cors from "cors";
import express, { type Response } from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { appConfig, isAllowedWebOrigin, rootDir } from "./config.js";
import { AppError, asyncRoute, errorMiddleware } from "./errors.js";
import { addLog, clearLogs, getLogs, requestLogger } from "./logger.js";
import { getCapabilities } from "./services/capabilityService.js";
import { chatCompletion, listAudioModels, listModels, loadLmStudioModel, streamChat, type ChatInput } from "./services/lmStudioClient.js";
import { addDocument, clearRag, queryRag, ragStats } from "./services/ragService.js";
import { kokoro, openVoice, requireConsent, rvc, whisper, xtts } from "./services/audioServices.js";
import { synthesizePiper } from "./services/piperService.js";
import { qwenAudio, qwenAudioToAudio, qwenText } from "./services/qwenOmniService.js";
import { createSession, realtimeStats } from "./realtime/realtimeService.js";
import { diagnoseLlamaCpp } from "./services/llamaCppService.js";
import { getSetupStatus } from "./services/setupService.js";
import { isValidCompanionToken, issueCompanionToken } from "./companionAuth.js";
import { loadPythonModel, pythonModelStatus } from "./services/modelLifecycleService.js";
import { startManagedLlama, stopManagedLlama } from "./services/runtimeLifecycleService.js";
import { listKokoroVoices } from "./services/kokoroVoiceCatalog.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: appConfig.maxUploadMb * 1024 * 1024, files: 1 },
});

function sendAdapterResult(res: Response, result: { audio?: Buffer; contentType?: string; json?: unknown }) {
  if (result.audio) {
    res.setHeader("content-type", result.contentType || "audio/wav");
    res.setHeader("content-length", result.audio.length);
    res.send(result.audio);
  } else {
    res.json({ ok: true, data: result.json });
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (req.headers["access-control-request-private-network"] === "true" && isAllowedWebOrigin(req.headers.origin)) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      callback(null, isAllowedWebOrigin(origin) && Boolean(origin));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Voice-Lab-Token"],
  }));
  app.use(express.json({ limit: "2mb" }));
  app.post("/api/pair", (req, res) => {
    if (!req.headers.origin || !isAllowedWebOrigin(req.headers.origin)) {
      res.status(403).json({ ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada para parear com o companion." } });
      return;
    }
    res.json({ ok: true, data: { token: issueCompanionToken(), expires: "when-companion-stops" } });
  });
  app.use("/api", (req, res, next) => {
    if (req.method === "OPTIONS" || req.path === "/pair") return next();
    if (!isValidCompanionToken(req.header("x-voice-lab-token"))) {
      res.status(401).json({ ok: false, error: { code: "PAIRING_REQUIRED", message: "Pareamento com o companion necessário." } });
      return;
    }
    next();
  });
  app.use(requestLogger);

  app.get("/api/health", asyncRoute(async (_req, res) => {
    let lmStudio: "online" | "offline" = "offline";
    let models = 0;
    try {
      const data = await listModels();
      models = Array.isArray((data as { data?: unknown[] }).data) ? (data as { data: unknown[] }).data.length : 0;
      lmStudio = "online";
    } catch {
      // Health stays 200: an optional runtime being offline is a capability state.
    }
    const memory = process.memoryUsage();
    res.json({
      ok: true,
      app: "Voice Lab",
      version: "1.0.0",
      uptimeSeconds: Math.round(process.uptime()),
      backend: "online",
      execution: { role: "local-companion", host: appConfig.host, allowedOrigins: appConfig.webOrigins },
      lmStudio: { status: lmStudio, baseUrl: appConfig.lmStudioBaseUrl, models },
      services: getCapabilities(),
      rag: ragStats(),
      realtime: realtimeStats(),
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      },
    });
  }));

  app.get("/api/setup/status", asyncRoute(async (_req, res) => {
    res.json({ ok: true, data: await getSetupStatus() });
  }));

  app.get("/api/lmstudio/models", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await listModels(String(req.query.baseUrl || appConfig.lmStudioBaseUrl)) });
  }));

  app.get("/api/lmstudio/audio-models", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await listAudioModels(String(req.query.baseUrl || appConfig.lmStudioBaseUrl)) });
  }));

  app.post("/api/lmstudio/models/load", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await loadLmStudioModel(String(req.body.baseUrl || appConfig.lmStudioBaseUrl), String(req.body.model || "")) });
  }));

  app.post("/api/models/status", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await pythonModelStatus(req.body.engine) });
  }));

  app.post("/api/models/load", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await loadPythonModel(req.body.engine, req.body.options || {}) });
  }));

  app.get("/api/llama-cpp/diagnose", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await diagnoseLlamaCpp(String(req.query.baseUrl || appConfig.llamaCppBaseUrl)) });
  }));

  app.post("/api/llama-cpp/start", asyncRoute(async (req, res) => {
    res.json({ ok: true, data: await startManagedLlama(req.body.hf) });
  }));

  app.post("/api/llama-cpp/stop", asyncRoute(async (_req, res) => {
    res.json({ ok: true, data: await stopManagedLlama() });
  }));

  app.post("/api/lmstudio/chat", asyncRoute(async (req, res) => {
    const input = req.body as ChatInput;
    if (!Array.isArray(input.messages) || input.messages.length === 0) {
      throw new AppError(400, "MESSAGES_REQUIRED", "Envie ao menos uma mensagem.");
    }
    if (input.stream) {
      const controller = new AbortController();
      const cancelUpstream = () => controller.abort();
      req.once("aborted", cancelUpstream);
      res.once("close", cancelUpstream);
      const body = await streamChat(input, controller.signal);
      const reader = body.getReader();
      try {
        res.setHeader("content-type", "text/event-stream; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        res.setHeader("connection", "keep-alive");
        while (!res.destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        req.off("aborted", cancelUpstream);
        res.off("close", cancelUpstream);
        if (!res.writableEnded) await reader.cancel().catch(() => undefined);
      }
      res.end();
      return;
    }
    const started = performance.now();
    const data = await chatCompletion(input);
    res.json({ ok: true, data, metrics: { generationMs: Math.round(performance.now() - started) } });
  }));

  app.post("/api/rag/upload", upload.single("file"), asyncRoute(async (req, res) => {
    const text = String(req.body.text || "");
    const file = req.file;
    if (!file && !text.trim()) throw new AppError(400, "SOURCE_REQUIRED", "Envie TXT, MD, PDF ou texto manual.");
    const name = file?.originalname || String(req.body.name || "fonte-manual.txt");
    const type = file?.mimetype || "text/plain";
    if (file && !/\.(txt|md|pdf)$/i.test(name)) throw new AppError(415, "UNSUPPORTED_DOCUMENT", "Formato não suportado.", "Use .txt, .md ou .pdf com texto extraível.");
    res.json({ ok: true, data: await addDocument({ name, type, text: file ? undefined : text, buffer: file?.buffer }) });
  }));

  app.post("/api/rag/query", asyncRoute(async (req, res) => {
    const query = String(req.body.query || "").trim();
    if (!query) throw new AppError(400, "QUERY_REQUIRED", "Informe uma pergunta.");
    res.json({ ok: true, data: queryRag(query, Number(req.body.limit || 4)) });
  }));
  app.delete("/api/rag", (_req, res) => {
    clearRag();
    res.json({ ok: true });
  });

  app.post("/api/tts/piper", asyncRoute(async (req, res) => {
    const result = await synthesizePiper(String(req.body.text || ""), Number(req.body.speed || 1));
    sendAdapterResult(res, result);
  }));
  app.post("/api/tts/kokoro", asyncRoute(async (req, res) => {
    sendAdapterResult(res, await kokoro(
      String(req.body.text || ""),
      String(req.body.voice || "pf_dora"),
      String(req.body.language || "pt-br"),
      Number(req.body.speed || 1),
    ));
  }));

  app.get("/api/tts/kokoro/voices", (_req, res) => {
    res.json({ ok: true, data: listKokoroVoices() });
  });
  app.post("/api/stt/whisper", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await whisper(req.file, String(req.body.language || "pt")));
  }));

  app.post("/api/voice-clone/xtts", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await xtts(req.body, req.file));
  }));
  app.post("/api/voice-clone/openvoice", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await openVoice(req.body, req.file));
  }));
  app.post("/api/voice-conversion/rvc", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await rvc(req.body, req.file));
  }));

  app.post("/api/qwen-omni/text", asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenText(req.body));
  }));
  app.post("/api/qwen-omni/audio", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenAudio(req.body, req.file));
  }));
  app.post("/api/qwen-omni/audio-to-audio", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenAudioToAudio(req.body, req.file));
  }));

  // Rotas neutras novas; os aliases qwen-omni acima permanecem para clientes antigos.
  app.post("/api/transformers/text", asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenText(req.body));
  }));
  app.post("/api/transformers/audio", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenAudio(req.body, req.file));
  }));
  app.post("/api/transformers/audio-to-audio", upload.single("audio"), asyncRoute(async (req, res) => {
    sendAdapterResult(res, await qwenAudioToAudio(req.body, req.file));
  }));

  app.post("/api/realtime/session", (req, res) => {
    const chunkMs = Number(req.body.chunkMs || 500);
    const mode = req.body.mode === "assistant" ? "assistant" : req.body.mode === "transport" ? "transport" : undefined;
    if (![250, 500, 1_000].includes(chunkMs)) {
      throw new AppError(400, "INVALID_CHUNK_DURATION", "O tamanho do chunk deve ser 250, 500 ou 1000 ms.");
    }
    if (!mode) {
      throw new AppError(400, "INVALID_REALTIME_MODE", "O modo deve ser assistant ou transport.");
    }
    const session = createSession(chunkMs, mode);
    res.status(201).json({
      ok: true,
      data: session,
      websocketPath: `/api/realtime?sessionId=${session.id}`,
      capabilities: {
        binaryAudioInput: true,
        chunkAcknowledgement: true,
        assistantPipeline: mode === "assistant" ? "browser-stt-to-lm-studio-to-browser-tts" : null,
        fullDuplexAudio: false,
      },
    });
  });

  app.delete("/api/voice-samples", asyncRoute(async (req, res) => {
    requireConsent(req.body?.consentConfirmed ?? req.query.consentConfirmed);
    const voiceDir = resolve(rootDir, "temp", "voices");
    const files = await readdir(voiceDir).catch(() => []);
    await Promise.all(files.filter((name) => name !== ".gitkeep").map((name) => rm(resolve(voiceDir, name), { force: true })));
    addLog({ level: "info", category: "privacy", message: `${files.length} amostra(s) temporária(s) removida(s).` });
    res.json({ ok: true, deleted: files.filter((name) => name !== ".gitkeep").length });
  }));

  app.get("/api/logs", (_req, res) => res.json({ ok: true, data: getLogs() }));
  app.delete("/api/logs", (_req, res) => {
    clearLogs();
    res.json({ ok: true });
  });

  const webDist = resolve(rootDir, "apps", "web", "dist");
  if (existsSync(resolve(webDist, "index.html"))) {
    app.use(express.static(webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(resolve(webDist, "index.html"));
    });
  }

  app.use((_req, _res, next) => next(new AppError(404, "ENDPOINT_NOT_FOUND", "Endpoint não implementado.")));
  app.use(errorMiddleware);
  return app;
}
