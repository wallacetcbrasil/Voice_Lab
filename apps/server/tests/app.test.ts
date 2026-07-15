import { describe, expect, it, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { clearRag } from "../src/services/ragService.js";
import { normalizeAudioModels } from "../src/services/lmStudioClient.js";
import { closeSession, connectSession, createSession, registerChunk } from "../src/realtime/realtimeService.js";

const testInternalToken = "voice-lab-test-internal-token";
process.env.VOICE_LAB_INTERNAL_TOKEN = testInternalToken;
const app = createApp();
let token = "";

beforeEach(async () => {
  clearRag();
  const pairing = await request(app).post("/api/pair").set("Origin", "http://localhost:5173");
  token = pairing.body.data.token;
});

describe("Voice Lab API", () => {
  it("rejects pairing from an unapproved public origin", async () => {
    const response = await request(app).post("/api/pair").set("Origin", "https://example.com");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("requires the ephemeral companion token", async () => {
    const response = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("PAIRING_REQUIRED");
  });

  it("reports health even when optional runtimes are offline", async () => {
    const response = await request(app).get("/api/health").set("X-Voice-Lab-Token", token);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.services).toHaveLength(8);
    expect(JSON.stringify(response.body)).not.toContain(testInternalToken);
  });

  it("reports host-aware setup probes without pretending optional tools are ready", async () => {
    const response = await request(app).get("/api/setup/status").set("X-Voice-Lab-Token", token);
    expect(response.status).toBe(200);
    expect(response.body.data.executionHost).toMatchObject({
      platform: expect.any(String),
      architecture: expect.any(String),
    });
    expect(response.body.data.base.node.status).toBe("ready");
    expect(response.body.data.base.node.stage).toBe("initialized");
    expect(response.body.data.runtimes.llamaCpp).toMatchObject({
      stage: expect.stringMatching(/^(not-installed|installed|initialized)$/),
      installation: { installed: expect.any(Boolean) },
      runtime: { state: expect.any(String) },
      model: { state: expect.any(String) },
    });
    expect(response.body.data.services).toHaveLength(8);
    expect(response.body.data.services.every((service: { stage?: string }) => Boolean(service.stage))).toBe(true);
  });

  it("indexes and retrieves lexical RAG context", async () => {
    await request(app).post("/api/rag/upload").set("X-Voice-Lab-Token", token).send({ name: "manual.md", text: "Piper transforma texto em voz local." }).expect(200);
    const response = await request(app).post("/api/rag/query").set("X-Voice-Lab-Token", token).send({ query: "O que o Piper transforma?" }).expect(200);
    expect(response.body.data.sources).toContain("manual.md");
    expect(response.body.data.prompt).toContain("Piper");
  });

  it("rejects voice cloning without explicit consent before checking the model", async () => {
    const response = await request(app).post("/api/voice-clone/xtts").set("X-Voice-Lab-Token", token).field("text", "teste");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("VOICE_CONSENT_REQUIRED");
  });

  it("returns an actionable error when the Python bridge is unavailable", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("connection refused"));
    try {
      const response = await request(app).post("/api/tts/kokoro").set("X-Voice-Lab-Token", token).send({ text: "teste" });
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("PYTHON_BACKEND_OFFLINE");
      expect(response.body.error.hint).toContain("Python");
    } finally {
      fetch.mockRestore();
    }
  });

  it("routes each Python engine to its isolated bridge", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array([82, 73, 70, 70]), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    }));
    try {
      await request(app).post("/api/tts/kokoro").set("X-Voice-Lab-Token", token).send({ text: "teste" }).expect(200);
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8101/api/tts/kokoro",
        expect.objectContaining({ method: "POST" }),
      );
      const bridgeRequest = fetch.mock.calls[0][1] as RequestInit;
      expect(new Headers(bridgeRequest.headers).get("x-voice-lab-internal-token")).toBe(testInternalToken);
    } finally {
      fetch.mockRestore();
    }
  });

  it("uses a consistent error envelope", async () => {
    const response = await request(app).get("/api/does-not-exist").set("X-Voice-Lab-Token", token);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ ok: false, error: { code: "ENDPOINT_NOT_FOUND" } });
  });

  it("creates an explicit realtime transport session without claiming full-duplex", async () => {
    const response = await request(app)
      .post("/api/realtime/session")
      .set("X-Voice-Lab-Token", token)
      .send({ chunkMs: 500, mode: "assistant" })
      .expect(201);
    expect(response.body.websocketPath).toMatch(/^\/api\/realtime\?sessionId=/);
    expect(response.body.capabilities).toMatchObject({
      binaryAudioInput: true,
      chunkAcknowledgement: true,
      assistantPipeline: "browser-stt-to-lm-studio-to-browser-tts",
      fullDuplexAudio: false,
    });
  });

  it("rejects an unknown realtime mode before opening a session", async () => {
    const response = await request(app)
      .post("/api/realtime/session")
      .set("X-Voice-Lab-Token", token)
      .send({ chunkMs: 500, mode: "fake" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_REALTIME_MODE");
  });
});

describe("Realtime session lifecycle", () => {
  it("only counts chunks while the session is connected", () => {
    const session = createSession(500, "transport");
    expect(registerChunk(session.id, 128)).toBeUndefined();
    expect(connectSession(session.id)?.status).toBe("connected");
    expect(connectSession(session.id)).toBeUndefined();
    expect(registerChunk(session.id, 128)).toMatchObject({ chunksReceived: 1, bytesReceived: 128 });
    expect(closeSession(session.id)?.status).toBe("closed");
    expect(registerChunk(session.id, 128)).toBeUndefined();
  });
});

describe("LM Studio audio model discovery", () => {
  it("groups quantizations and prioritizes the loaded audio variant", () => {
    const models = normalizeAudioModels([
      {
        type: "llm",
        key: "qwen2.5-omni-3b@q4_k_m",
        display_name: "Qwen2.5 Omni 3B",
        architecture: "qwen2vl",
        format: "gguf",
        params_string: "3B",
        size_bytes: 7_327_300_610,
        quantization: { name: "Q4_K_M" },
        loaded_instances: [],
      },
      {
        type: "llm",
        key: "qwen2.5-omni-3b@q2_k",
        display_name: "Qwen2.5 Omni 3B",
        architecture: "qwen2vl",
        format: "gguf",
        params_string: "3B",
        size_bytes: 6_599_224_322,
        quantization: { name: "Q2_K" },
        loaded_instances: [{ id: "qwen-omni-loaded" }],
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0].variants).toHaveLength(2);
    expect(models[0].variants[0]).toMatchObject({ id: "qwen2.5-omni-3b@q2_k", loaded: true });
  });

  it("does not classify generic Omni names such as OmniCoder as audio", () => {
    const models = normalizeAudioModels([
      {
        type: "llm",
        key: "omnicoder-qwen3.5-9b",
        display_name: "OmniCoder",
        architecture: "qwen35",
        capabilities: { vision: true },
        loaded_instances: [],
      },
      {
        type: "embedding",
        key: "qwen2.5-omni-embedding",
        display_name: "Qwen Omni embedding",
        loaded_instances: [],
      },
    ]);
    expect(models).toEqual([]);
  });
});
