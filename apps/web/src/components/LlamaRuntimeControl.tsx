import { CheckCircle2, Copy, PlayCircle, RefreshCw, StopCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, postJson } from "../services/apiClient";
import { Button, Field, Input, LongOperationNotice, StatusMessage } from "./Controls";

export interface LlamaDiagnosis {
  platform: string;
  binaryFound: boolean;
  binaryPath: string | null;
  serverOnline: boolean;
  baseUrl: string;
  models: Array<{ id?: string }>;
  connectionError: string;
  diagnosis: string;
}

interface LifecyclePayload {
  data: {
    action: "start" | "stop";
    lmStudioOnline: boolean;
    diagnosis: LlamaDiagnosis;
  };
}

const defaultReference = "ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M";

export function LlamaRuntimeControl({
  baseUrl,
  onStatus,
}: {
  baseUrl: string;
  onStatus: (diagnosis: LlamaDiagnosis | null) => void;
}) {
  const [hf, setHf] = useState(defaultReference);
  const [diagnosis, setDiagnosis] = useState<LlamaDiagnosis | null>(null);
  const [operation, setOperation] = useState<"start" | "stop" | "">("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const publishStatus = (next: LlamaDiagnosis | null) => {
    setDiagnosis(next);
    onStatus(next);
  };

  const refresh = async () => {
    setChecking(true);
    setError("");
    try {
      const payload = await api<{ data: LlamaDiagnosis }>(`/api/llama-cpp/diagnose?baseUrl=${encodeURIComponent(baseUrl)}`);
      publishStatus(payload.data);
    } catch (caught) {
      publishStatus(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível verificar o llama.cpp.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { void refresh(); }, [baseUrl]);

  const run = async (action: "start" | "stop") => {
    setOperation(action);
    setError("");
    try {
      const payload = await postJson<LifecyclePayload>(`/api/llama-cpp/${action}`, action === "start" ? { hf } : {});
      publishStatus(payload.data.diagnosis);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha ao controlar o llama.cpp.";
      const hint = caught instanceof ApiError ? caught.hint : undefined;
      await refresh();
      setError(hint ? `${message} — ${hint}` : message);
    } finally {
      setOperation("");
    }
  };

  const command = `npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start llama --hf=${hf}`;
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("O navegador bloqueou a cópia. Selecione o comando manualmente.");
    }
  };

  const ready = Boolean(diagnosis?.serverOnline && diagnosis.models.length > 0);
  const activeModel = diagnosis?.models.find((model) => model.id)?.id;

  return (
    <section className="runtime-control" aria-label="Controle do runtime llama.cpp">
      <div className="runtime-control-heading">
        <div><span className="section-label">RUNTIME LOCAL</span><h3>Iniciar somente o llama.cpp</h3><p>Ao iniciar, o Voice Lab descarrega os modelos e para a API do LM Studio antes de carregar este GGUF.</p></div>
        <Button variant="secondary" onClick={refresh} busy={checking} disabled={Boolean(operation)}><RefreshCw size={16} /> Verificar</Button>
      </div>

      <Field label="Modelo GGUF no Hugging Face" hint="Use organização/repositório:quantização. Apenas uma referência é carregada.">
        <Input value={hf} onChange={(event) => setHf(event.target.value)} disabled={Boolean(operation) || diagnosis?.serverOnline} />
      </Field>

      <div className="action-row">
        <Button onClick={() => void run("start")} disabled={!diagnosis?.binaryFound || Boolean(diagnosis?.serverOnline) || !hf.trim()} busy={operation === "start"}><PlayCircle size={16} /> Iniciar llama.cpp</Button>
        <Button variant="danger" onClick={() => void run("stop")} disabled={!diagnosis?.serverOnline} busy={operation === "stop"}><StopCircle size={16} /> Encerrar llama.cpp</Button>
      </div>

      <LongOperationNotice
        active={operation === "start"}
        title="Trocando o runtime e carregando o GGUF"
        detail="O LM Studio é parado primeiro. O download inicial e a alocação de RAM/VRAM podem levar vários minutos; o teste será liberado somente após /health responder."
      />

      {ready && <StatusMessage type="success" title="llama.cpp pronto"><CheckCircle2 size={14} /> Endpoint validado em {diagnosis?.baseUrl}. Modelo anunciado: {activeModel}.</StatusMessage>}
      {diagnosis && !diagnosis.binaryFound && <StatusMessage title="llama.cpp não instalado">Abra Instalação e Diagnóstico para instalar o binário antes de iniciar este runtime.</StatusMessage>}
      {diagnosis?.binaryFound && !diagnosis.serverOnline && !error && <StatusMessage type="info" title="llama.cpp instalado e parado">Nenhum modelo está ocupando memória neste runtime. Escolha a referência acima e inicie quando for executar este laboratório.</StatusMessage>}
      {diagnosis?.serverOnline && diagnosis.models.length === 0 && <StatusMessage title="Servidor sem modelo anunciado">O endpoint respondeu, mas `/v1/models` não informou um modelo. Encerre e inicie novamente com uma referência válida.</StatusMessage>}
      {error && <StatusMessage title="Não foi possível trocar o runtime">{error}</StatusMessage>}

      <div className="runtime-command">
        <div><strong>Alternativa pelo terminal</strong><p>O mesmo comando também encerra a API do LM Studio antes de iniciar o llama.cpp.</p></div>
        <div className="copy-command"><code>{command}</code><button type="button" onClick={copyCommand}><Copy size={15} /> {copied ? "Copiado" : "Copiar"}</button></div>
      </div>
    </section>
  );
}
