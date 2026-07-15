import { appConfig, pathState } from "../config.js";
import type { ServiceCapability } from "../types.js";
import { AppError } from "../errors.js";
import { relative } from "node:path";
import { rootDir } from "../config.js";

const hints: Record<string, string> = {
  piper: "Abra Instalação e Diagnóstico e execute o instalador único.",
  kokoro: "Abra Instalação e Diagnóstico e execute o instalador único.",
  whisper: "Abra Instalação e Diagnóstico e execute o instalador único.",
  xtts: "Abra Instalação e Diagnóstico e execute o instalador único.",
  openvoice: "Instale o motor pelo comando único; o checkpoint oficial permanece uma etapa separada.",
  rvc: "Instale o motor pelo comando único e forneça somente um modelo próprio ou autorizado.",
  transformers: "Instale o runtime pelo comando único; escolha o checkpoint multimodal no laboratório.",
  realtime: "O transporte WebSocket recebe chunks de áudio e confirma o recebimento; STT, modelo e TTS são capacidades separadas.",
};

export function getCapabilities(): ServiceCapability[] {
  return Object.entries(appConfig.services).map(([id, service]) => {
    const modelFound = service.model ? pathState(service.model) : false;
    const binaryFound = "binary" in service ? Boolean(service.binary && pathState(service.binary)) : true;
    const configuredPath = modelFound && binaryFound;
    const status = id === "realtime" ? "ready" : configuredPath ? "ready" : "unavailable";
    const absoluteSearchedPaths = [
      ...("binarySearchedPaths" in service ? service.binarySearchedPaths : []),
      ...service.searchedPaths,
    ];
    const searchedPaths = absoluteSearchedPaths.map((path) => relative(rootDir, path).replaceAll("\\", "/"));
    const detectedPath = status === "ready"
      ? service.configuredBy === "environment"
        ? "Override administrativo do servidor"
        : "binary" in service
          ? `${relative(rootDir, service.binary).replaceAll("\\", "/")} · ${relative(rootDir, service.model).replaceAll("\\", "/")}`
          : relative(rootDir, service.model).replaceAll("\\", "/")
      : undefined;
    return {
      id,
      label: id === "transformers" ? "Transformers multimodal" : id === "openvoice" ? "OpenVoice V2" : id === "realtime" ? "Realtime WebSocket" : id.toUpperCase(),
      enabled: status === "ready",
      status,
      detail: status === "ready"
        ? id === "realtime" ? "Transporte binário e ACKs integrados ao Companion" : `Reconhecido ${service.configuredBy === "auto" ? "no caminho padrão" : "pela configuração do servidor"}`
        : `Ainda não encontrado · ${searchedPaths.length} local(is) padrão verificado(s)`,
      installHint: hints[id],
      features: id === "realtime"
        ? ["websocket", "binary-audio-in", "chunk-ack", "vad-metadata"]
        : id === "whisper"
        ? ["audio-in", "text-out"]
        : id === "rvc"
          ? ["audio-in", "audio-out", "conversion"]
          : id === "transformers"
            ? ["text-in", "audio-in", "text-out"]
            : id === "openvoice" || id === "xtts"
              ? ["text-in", "audio-reference", "audio-out"]
              : ["text-in", "audio-out"],
      configuredBy: service.configuredBy,
      detectedPath,
      searchedPaths,
    };
  });
}

export function requireService(id: keyof typeof appConfig.services) {
  const capability = getCapabilities().find((item) => item.id === id)!;
  if (capability.status !== "ready") {
    throw new AppError(503, "SERVICE_NOT_CONFIGURED", capability.detail, capability.installHint);
  }
  return capability;
}
