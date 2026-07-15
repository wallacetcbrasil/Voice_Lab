import { createServer } from "node:http";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { createApp } from "./app.js";
import { appConfig, isAllowedWebOrigin } from "./config.js";
import { addLog } from "./logger.js";
import { closeSession, connectSession, registerChunk } from "./realtime/realtimeService.js";
import { isValidCompanionToken } from "./companionAuth.js";

const server = createServer(createApp());
const realtime = new WebSocketServer({ noServer: true, maxPayload: appConfig.maxUploadMb * 1024 * 1024 });
const socketSessions = new WeakMap<WebSocket, string>();

server.on("upgrade", (request, socket, head) => {
  if (!request.headers.origin || !isAllowedWebOrigin(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/api/realtime") {
    socket.destroy();
    return;
  }
  if (!isValidCompanionToken(url.searchParams.get("token"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!connectSession(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  realtime.handleUpgrade(request, socket, head, (ws) => {
    socketSessions.set(ws, sessionId);
    realtime.emit("connection", ws, request);
  });
});

realtime.on("connection", (socket: WebSocket) => {
  const sessionId = socketSessions.get(socket) || "";
  const pendingSequences: number[] = [];
  addLog({ level: "info", category: "realtime", message: `Sessão ${sessionId.slice(0, 8)} conectada.` });
  socket.send(JSON.stringify({
    type: "ready",
    sessionId,
    serverAt: Date.now(),
    capabilities: {
      binaryAudioInput: true,
      chunkAcknowledgement: true,
      streamingStt: false,
      nativeAudioOutput: false,
    },
  }));
  socket.on("message", (data: RawData, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const event = JSON.parse(data.toString()) as { type?: string; sequence?: number; clientAt?: number };
        if (event.type !== "chunk-meta" || !Number.isSafeInteger(event.sequence) || Number(event.sequence) <= 0) {
          socket.send(JSON.stringify({ type: "warning", message: "Metadado de chunk inválido." }));
          return;
        }
        if (pendingSequences.length >= 32) {
          socket.close(1008, "Metadados sem chunks correspondentes");
          return;
        }
        pendingSequences.push(event.sequence!);
        socket.send(JSON.stringify({ type: "meta-ack", sequence: event.sequence, clientAt: event.clientAt, serverAt: Date.now() }));
      } catch {
        socket.send(JSON.stringify({ type: "warning", message: "Metadado JSON inválido." }));
      }
      return;
    }
    const chunkBytes = Array.isArray(data)
      ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
      : data.byteLength;
    const sequence = pendingSequences.shift();
    if (sequence === undefined) {
      socket.send(JSON.stringify({ type: "warning", message: "Chunk de áudio recebido sem metadado associado." }));
      return;
    }
    const session = registerChunk(sessionId, chunkBytes);
    if (!session) {
      socket.close(1008, "Sessão não está ativa");
      return;
    }
    socket.send(JSON.stringify({
      type: "chunk-ack",
      sequence,
      chunksReceived: session.chunksReceived,
      bytes: chunkBytes,
      totalBytes: session.bytesReceived,
      serverAt: Date.now(),
    }));
  });
  socket.on("close", () => {
    closeSession(sessionId);
    addLog({ level: "info", category: "realtime", message: `Sessão ${sessionId.slice(0, 8)} encerrada.` });
  });
  socket.on("error", (error) => {
    addLog({ level: "error", category: "realtime", message: `WebSocket ${sessionId.slice(0, 8)}: ${error.message}` });
  });
});

server.listen(appConfig.port, appConfig.host, () => {
  console.log(`Voice Lab Companion: http://${appConfig.host}:${appConfig.port}`);
  console.log(`Realtime WS: ws://${appConfig.host}:${appConfig.port}/api/realtime`);
});
