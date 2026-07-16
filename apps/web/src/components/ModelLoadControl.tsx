import { CheckCircle2, Download, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, postJson } from "../services/apiClient";
import { Button, StatusMessage } from "./Controls";

export type LoadablePythonEngine = "kokoro" | "whisper" | "xtts" | "openvoice" | "transformers";

interface ModelStatus {
  engine: LoadablePythonEngine;
  state: "idle" | "loading" | "loaded" | "error";
  configured: boolean;
  loaded: boolean;
  model?: string;
  path?: string;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  progressAvailable: false;
  error?: string;
  phase?: string;
}

function errorText(error: unknown) {
  return error instanceof ApiError && error.hint
    ? `${error.message} — ${error.hint}`
    : error instanceof Error ? error.message : "Falha ao verificar o checkpoint.";
}

export function ModelLoadControl({
  engine,
  label,
  options = {},
  onReady,
  disabled = false,
  disabledReason,
}: {
  engine: LoadablePythonEngine;
  label: string;
  options?: Record<string, unknown>;
  onReady: (ready: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const optionsKey = useMemo(() => JSON.stringify(options), [options]);
  const stableOptions = useMemo(() => JSON.parse(optionsKey) as Record<string, unknown>, [optionsKey]);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState<ModelStatus>();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number>();

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  const check = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    try {
      const response = await postJson<{ data: ModelStatus }>("/api/models/status", { engine, options: stableOptions });
      setStatus(response.data);
      onReadyRef.current(response.data.loaded && !disabled);
      const stillLoading = response.data.state === "loading" && !response.data.loaded;
      setLoading(stillLoading);
      if (stillLoading && response.data.startedAt) {
        setStartedAt(response.data.startedAt * 1000);
      }
      if (response.data.state === "error" && response.data.error) setError(response.data.error);
    } catch (error) {
      onReadyRef.current(false);
      if (!silent) setError(errorText(error));
    } finally {
      if (!silent) setChecking(false);
    }
  }, [disabled, engine, stableOptions]);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    if (!loading || !startedAt) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    const probe = window.setInterval(() => { void check(true); }, 3_000);
    return () => { window.clearInterval(timer); window.clearInterval(probe); };
  }, [check, loading, startedAt]);

  const load = async () => {
    const started = Date.now();
    setStartedAt(started);
    setElapsed(0);
    setLoading(true);
    setError("");
    onReadyRef.current(false);
    try {
      const response = await postJson<{ data: ModelStatus }>("/api/models/load", { engine, options: stableOptions });
      setStatus(response.data);
      onReadyRef.current(Boolean(response.data.loaded));
    } catch (error) {
      setError(errorText(error));
      onReadyRef.current(false);
    } finally {
      setLoading(false);
    }
  };

  if (checking && !status) {
    return <div className="model-load-control checking"><LoaderCircle className="spin" /><div><strong>Verificando {label}</strong><p>Consultando o bridge local; nenhum modelo é carregado por esta sonda.</p></div></div>;
  }

  if (status?.loaded && !disabled) {
    return (
      <div className="model-load-control loaded">
        <CheckCircle2 />
        <div><strong>{label} carregado</strong><p>{status.model || status.path || "Checkpoint confirmado pelo bridge local."}</p></div>
        {status.elapsedMs !== undefined && status.elapsedMs > 0 && <span>{Math.ceil(status.elapsedMs / 1000)} s</span>}
      </div>
    );
  }

  const phaseText = status?.phase === "downloading-checkpoints"
    ? "Baixando checkpoints oficiais do OpenVoice V2 no Hugging Face."
    : status?.phase === "loading-converter"
      ? "Checkpoint recebido; carregando o conversor de timbre."
      : status?.phase === "loading-melotts"
        ? "Conversor pronto; carregando a voz-base do MeloTTS."
        : status?.phase === "downloading-or-loading"
          ? "Baixando ou carregando o checkpoint XTTS-v2 após a confirmação da licença."
          : "Download e alocação estão em andamento. Este runtime não fornece percentual; o tempo exibido é medido de verdade.";

  return (
    <>
      <div className={`model-load-control ${loading ? "loading" : "pending"}`}>
        {loading ? <LoaderCircle className="spin" /> : <Download />}
        <div>
          <strong>{loading ? `Carregando ${label} · ${elapsed} s` : `${label} ainda não está na memória`}</strong>
          <p>{loading
            ? phaseText
            : status?.configured ? "O checkpoint foi encontrado no disco e pode ser carregado agora." : "O primeiro carregamento também pode baixar arquivos oficiais e levar vários minutos."}</p>
          {loading && <div className="indeterminate-progress" aria-label={`Carregando ${label} há ${elapsed} segundos`}><span /></div>}
        </div>
        {!loading && <Button onClick={load} disabled={disabled}><Download size={15} /> Carregar modelo</Button>}
      </div>
      {disabled && disabledReason && <StatusMessage type="info" title="Confirmação necessária">{disabledReason}</StatusMessage>}
      {error && <StatusMessage title={`Não foi possível carregar ${label}`}>{error}</StatusMessage>}
    </>
  );
}
