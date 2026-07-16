import {
  CheckCircle2,
  CircleAlert,
  CircleX,
  Cloud,
  Copy,
  ExternalLink,
  Laptop,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  Server,
  StopCircle,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ResultPanel, StatusMessage } from "../components/Controls";
import { LabFrame } from "../components/LabFrame";
import { getCompanionBaseUrl } from "../services/apiClient";
import {
  fetchSetupStatus,
  flattenSetupStatus,
  type ModelStage,
  type SetupProbe,
  type SetupStage,
  type SetupStatusPayload,
} from "../services/setupService";
import { speechRecognitionSupported } from "../services/speechRecognitionClient";
import { labById } from "./catalog";

interface ModelReference {
  label: string;
  detail: string;
  url: string;
}

interface ToolGuide {
  title: string;
  runsAt: string;
  summary: string;
  documentation: string;
  models?: ModelReference[];
}

interface CommandAction {
  id: string;
  label: string;
  description: string;
  command: string;
  tone: "install" | "start" | "stop";
}

const PACKAGE_SOURCE = "github:wallacetcbrasil/Voice_Lab";
const packageCommand = (binary: string, args = "") => `npx --yes --package=${PACKAGE_SOURCE} ${binary}${args ? ` ${args}` : ""}`;
const voiceLabCommand = (args: string) => packageCommand("voice-lab", args);
const currentOriginArgument = (() => {
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  return window.location.protocol === "https:" || (loopback && window.location.protocol === "http:")
    ? ` --origin=${window.location.origin}`
    : "";
})();
const COMPANION_COMMAND = voiceLabCommand(`start${currentOriginArgument}`);
const INSTALL_ALL_COMMAND = voiceLabCommand("setup");
const BASE_COMPANION_ACTION: CommandAction = {
  id: "base-companion",
  label: "Iniciar e verificar o companion",
  description: "Inicializa somente os componentes já instalados; não carrega LM Studio, llama.cpp ou checkpoints de áudio.",
  command: COMPANION_COMMAND,
  tone: "start",
};
const INSTALL_ALL_ACTION: CommandAction = {
  id: "install-all",
  label: "Instalar e validar todas as ferramentas",
  description: "Verifica cada item, pula o que já existe e instala somente o que estiver ausente, um por vez.",
  command: INSTALL_ALL_COMMAND,
  tone: "install",
};

const toolGuides: Record<string, ToolGuide> = {
  node: {
    title: "Voice Lab Companion",
    runsAt: "Computador do usuário · 127.0.0.1:3333",
    summary: "Conecta a interface publicada aos runtimes locais. O comando base verifica os pré-requisitos essenciais e inicia somente o companion; modelos pesados continuam parados.",
    documentation: "https://github.com/wallacetcbrasil/Voice_Lab",
  },
  npm: {
    title: "npm",
    runsAt: "Computador do usuário",
    summary: "É distribuído com Node.js e executa os comandos públicos do Voice Lab.",
    documentation: "https://nodejs.org/en/download",
  },
  git: {
    title: "Git",
    runsAt: "Computador do usuário",
    summary: "É usado somente quando uma dependência oficial precisa ser obtida de um repositório Git.",
    documentation: "https://git-scm.com/downloads",
  },
  python: {
    title: "Python",
    runsAt: "Computador do usuário",
    summary: "O instalador mantém ambientes isolados por motor para reduzir conflitos de versão.",
    documentation: "https://www.python.org/downloads/",
  },
  lmStudio: {
    title: "LM Studio",
    runsAt: "Aplicativo no computador do usuário · API local 1234",
    summary: "Instalação, servidor e modelo são estados separados. Iniciar o servidor não carrega um modelo; a escolha continua no laboratório.",
    documentation: "https://lmstudio.ai/download",
    models: [{
      label: "Exemplo leve com entrada de áudio",
      detail: "No catálogo do LM Studio, procure ggml-org/Voxtral-Mini-3B-2507-GGUF e comece pela quantização Q4_K_M.",
      url: "https://huggingface.co/ggml-org/Voxtral-Mini-3B-2507-GGUF",
    }],
  },
  llamaCpp: {
    title: "llama.cpp",
    runsAt: "Processo llama-server no computador do usuário · API local 8080",
    summary: "O runtime pode estar instalado e parado. O comando de início carrega somente o modelo indicado e encerra antes um runtime conflitante gerenciado pelo Voice Lab.",
    documentation: "https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md",
    models: [{
      label: "GGUF de exemplo compatível com áudio",
      detail: "ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M; o comando -hf obtém também o projetor multimodal exigido.",
      url: "https://huggingface.co/ggml-org/Voxtral-Mini-3B-2507-GGUF",
    }],
  },
  pythonBridge: {
    title: "Bridge Python",
    runsAt: "Processo local iniciado pelo companion",
    summary: "Expõe os adaptadores Python instalados. Os motores ficam isolados e nenhum checkpoint pesado é carregado durante o início do companion.",
    documentation: "https://fastapi.tiangolo.com/",
  },
  piper: {
    title: "Piper",
    runsAt: "Motor local isolado",
    summary: "TTS local por voz ONNX. O estado do pacote, da voz e do processo é apresentado separadamente.",
    documentation: "https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md",
    models: [{
      label: "Voz de exemplo em português do Brasil",
      detail: "pt_BR-faber-medium; baixada para a área persistente do Voice Lab pelo instalador do motor.",
      url: "https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR/faber/medium",
    }],
  },
  kokoro: {
    title: "Kokoro",
    runsAt: "Motor Python local isolado",
    summary: "TTS local; os pesos são obtidos somente quando a geração realmente precisar deles.",
    documentation: "https://github.com/hexgrad/kokoro",
  },
  whisper: {
    title: "Faster-Whisper",
    runsAt: "Motor Python local isolado",
    summary: "STT local. O checkpoint é escolhido e carregado apenas no laboratório de transcrição.",
    documentation: "https://github.com/SYSTRAN/faster-whisper",
  },
  xtts: {
    title: "XTTS-v2",
    runsAt: "Motor Python local isolado",
    summary: "TTS com referência de voz autorizada. Instalar o motor não carrega o checkpoint em memória.",
    documentation: "https://github.com/idiap/coqui-ai-TTS",
    models: [{
      label: "Checkpoint padrão do laboratório",
      detail: "tts_models/multilingual/multi-dataset/xtts_v2; obtido pelo motor na primeira utilização autorizada.",
      url: "https://huggingface.co/coqui/XTTS-v2",
    }],
  },
  openvoice: {
    title: "OpenVoice V2",
    runsAt: "Motor Python local isolado",
    summary: "Clonagem de timbre e estilo. Após consentimento, o laboratório baixa os checkpoints do repositório oficial e fixado no Hugging Face.",
    documentation: "https://github.com/myshell-ai/OpenVoice/blob/main/docs/USAGE.md",
    models: [{
      label: "Checkpoints oficiais OpenVoice V2",
      detail: "myshell-ai/OpenVoiceV2; conversor e vozes-base são baixados somente ao carregar o modelo.",
      url: "https://huggingface.co/myshell-ai/OpenVoiceV2",
    }],
  },
  rvc: {
    title: "RVC",
    runsAt: "Motor Python local isolado",
    summary: "Conversão de uma gravação existente. O usuário fornece um modelo próprio ou autorizado no laboratório.",
    documentation: "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion",
  },
  qwen: {
    title: "Transformers multimodal",
    runsAt: "Motor Python local isolado",
    summary: "Caminho para checkpoints nativos em Safetensors. Instalar as bibliotecas não baixa nem carrega o modelo.",
    documentation: "https://huggingface.co/docs/transformers/model_doc/voxtral",
    models: [{
      label: "Checkpoint de exemplo",
      detail: "mistralai/Voxtral-Mini-3B-2507 · áudio/texto para texto.",
      url: "https://huggingface.co/mistralai/Voxtral-Mini-3B-2507",
    }],
  },
  transformers: {
    title: "Transformers multimodal",
    runsAt: "Motor Python local isolado",
    summary: "Caminho para checkpoints nativos em Safetensors. Instalar as bibliotecas não baixa nem carrega o modelo.",
    documentation: "https://huggingface.co/docs/transformers/model_doc/voxtral",
    models: [{
      label: "Checkpoint de exemplo",
      detail: "mistralai/Voxtral-Mini-3B-2507 · áudio/texto para texto.",
      url: "https://huggingface.co/mistralai/Voxtral-Mini-3B-2507",
    }],
  },
  realtime: {
    title: "Realtime WebSocket",
    runsAt: "Voice Lab Companion",
    summary: "O transporte é iniciado com o companion. STT, modelo e TTS usados na conversa permanecem capacidades independentes.",
    documentation: "https://developer.mozilla.org/docs/Web/API/WebSocket",
  },
};

const stageLabels: Record<SetupStage, string> = {
  "not-installed": "Não instalado",
  installed: "Instalado",
  initialized: "Inicializado",
};

const modelLabels: Record<ModelStage, string> = {
  "not-required": "Não exige modelo",
  missing: "Modelo ausente",
  available: "Modelo disponível",
  unloaded: "Disponível, não carregado",
  loaded: "Modelo carregado",
  error: "Erro ao verificar modelo",
  unknown: "Modelo não verificado",
};

const engineAliases: Record<string, string> = {
  pythonBridge: "bridge",
  qwen: "transformers",
};

function runtimeCommand(action: "start" | "stop", runtime: string) {
  return voiceLabCommand(`${action} ${runtime}`);
}

function fallbackInstallCommand(id: string) {
  if (id === "node" || id === "npm") return "winget install --id OpenJS.NodeJS.LTS -e";
  if (id === "git") return "winget install --id Git.Git -e";
  if (id === "python") return "winget install --id astral-sh.uv -e";
  return voiceLabCommand(`setup --only=${engineAliases[id] || id}`);
}

function fallbackRuntimeCommands(id: string) {
  if (id === "lmStudio") return { start: runtimeCommand("start", "lmstudio"), stop: runtimeCommand("stop", "lmstudio") };
  if (id === "llamaCpp") return { start: runtimeCommand("start", "llama"), stop: runtimeCommand("stop", "llama") };
  if (["pythonBridge", "piper", "kokoro", "whisper", "xtts", "openvoice", "rvc", "qwen", "transformers", "realtime"].includes(id)) {
    return { start: COMPANION_COMMAND, stop: runtimeCommand("stop", "companion") };
  }
  return {};
}

function actionsForProbe(probe: SetupProbe): CommandAction[] {
  const fallback = fallbackRuntimeCommands(probe.id);
  const install = fallbackInstallCommand(probe.id);
  const start = fallback.start || probe.startCommand;
  const stop = fallback.stop || probe.stopCommand;
  const companionManaged = ["pythonBridge", "piper", "kokoro", "whisper", "xtts", "openvoice", "rvc", "qwen", "transformers", "realtime"].includes(probe.id);

  if (probe.stage === "not-installed") {
    return [{
      id: `${probe.id}-install`,
      label: `Instalar ${probe.label}`,
      description: "Verifica novamente e instala apenas esta dependência quando ela estiver ausente.",
      command: install,
      tone: "install",
    }];
  }
  if (probe.stage === "installed" && start) {
    return [{
      id: `${probe.id}-start`,
      label: companionManaged ? "Iniciar companion e bridges" : `Iniciar ${probe.label}`,
      description: companionManaged ? "Inicializa os adaptadores instalados sem carregar checkpoints pesados." : "Inicia o processo necessário sem carregar outros modelos pesados.",
      command: start,
      tone: "start",
    }];
  }
  if (probe.stage === "initialized" && stop) {
    return [{
      id: `${probe.id}-stop`,
      label: companionManaged ? "Encerrar companion e bridges" : `Encerrar ${probe.label}`,
      description: companionManaged ? "Encerra o processo compartilhado do companion e seus bridges; nenhum modelo externo é encerrado por este comando." : "Encerra somente o processo gerenciado e libera os recursos associados.",
      command: stop,
      tone: "stop",
    }];
  }
  return [];
}

function CopyCommand({ action }: { action: CommandAction }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API indisponível");
      await navigator.clipboard.writeText(action.command);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className={`command-card command-${action.tone}`}>
      <div className="command-heading">
        {action.tone === "start" ? <PlayCircle /> : action.tone === "stop" ? <StopCircle /> : <PackageCheck />}
        <div><strong>{action.label}</strong><p>{action.description}</p></div>
      </div>
      <div className="copy-command">
        <code>{action.command}</code>
        <button type="button" onClick={copy} aria-label={`Copiar comando: ${action.label}`}>
          <Copy size={16} /> {copyState === "copied" ? "Copiado" : copyState === "error" ? "Falhou" : "Copiar"}
        </button>
      </div>
      {copyState === "error" && <small className="copy-error">O navegador bloqueou a área de transferência. Selecione o comando manualmente.</small>}
    </div>
  );
}

function StageRail({ stage }: { stage: SetupStage }) {
  const current = stage === "not-installed" ? 0 : stage === "installed" ? 1 : 2;
  const labels: SetupStage[] = ["not-installed", "installed", "initialized"];
  return (
    <div className="stage-rail" role="img" aria-label={`Etapa atual: ${stageLabels[stage]}`}>
      {labels.map((item, index) => (
        <span className={index <= current ? "reached" : ""} key={item}>
          <i />
          <small>{stageLabels[item]}</small>
        </span>
      ))}
    </div>
  );
}

function ProbeCard({ probe, selected, onSelect }: { probe: SetupProbe; selected: boolean; onSelect: () => void }) {
  const StatusIcon = probe.stage === "initialized" ? CheckCircle2 : probe.stage === "installed" ? CircleAlert : CircleX;
  const detail = probe.runtimeDetail || probe.version || probe.detail || "A sonda não retornou detalhes.";
  return (
    <button
      type="button"
      className={`setup-probe stage-${probe.stage} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="probe-heading">
        <StatusIcon />
        <div><strong>{probe.label}</strong><p>{detail}</p></div>
        <span className="stage-badge">{stageLabels[probe.stage]}</span>
      </div>
      <StageRail stage={probe.stage} />
      {probe.modelStage !== "unknown" && (
        <div className={`probe-model model-${probe.modelStage}`}>
          <span>Modelo</span><strong>{modelLabels[probe.modelStage]}</strong>
        </div>
      )}
    </button>
  );
}

function GuidePanel({ probe }: { probe?: SetupProbe }) {
  const guide = toolGuides[probe?.id || "node"] || {
    title: probe?.label || "Ferramenta",
    runsAt: "Host informado pelo diagnóstico",
    summary: probe?.detail || "Consulte o diagnóstico retornado pelo companion.",
    documentation: probe?.url || "https://github.com/wallacetcbrasil/Voice_Lab",
  };
  const actions = probe ? actionsForProbe(probe) : [];
  const showModel = Boolean(guide.models?.length) || Boolean(probe && probe.modelStage !== "unknown" && probe.modelStage !== "not-required");

  return (
    <section className="tool-guide-panel" aria-live="polite">
      <div className="tool-guide-heading">
        <TerminalSquare />
        <div><span className="section-label">AÇÃO PARA A ETAPA ATUAL</span><h3>{guide.title}</h3><p>{guide.summary}</p></div>
      </div>
      <div className="runtime-location"><Laptop size={17} /><strong>Onde roda:</strong><span>{guide.runsAt}</span></div>
      {probe?.conflictGroup && <StatusMessage type="info" title="Recursos compartilhados">Pertence ao grupo <code>{probe.conflictGroup}</code>. O comando de runtime coordena a troca para evitar modelos pesados concorrentes.</StatusMessage>}

      {actions.length > 0 ? <div className="context-command-list">{actions.map((action) => <CopyCommand key={action.id} action={action} />)}</div> : (
        <div className="no-action-needed"><CheckCircle2 /><div><strong>Nenhum comando necessário nesta etapa</strong><p>O diagnóstico já reconheceu a ferramenta e não há processo gerenciado para iniciar ou encerrar.</p></div></div>
      )}

      {showModel && (
        <div className="model-separation">
          <div><span className="section-label">MODELO · ESTADO INDEPENDENTE</span><strong>{probe ? modelLabels[probe.modelStage] : "Modelo não verificado"}</strong><p>{probe?.modelDetail || "A instalação do runtime não baixa nem carrega um modelo pesado automaticamente."}</p></div>
          {guide.models?.map((model) => (
            <a key={model.url} href={model.url} target="_blank" rel="noreferrer">
              <div><strong>{model.label}</strong><span>{model.detail}</span></div><ExternalLink size={16} />
            </a>
          ))}
        </div>
      )}

      <a className="documentation-link" href={guide.documentation} target="_blank" rel="noreferrer">Abrir documentação oficial <ExternalLink size={14} /></a>
    </section>
  );
}

export function SetupLab() {
  const [status, setStatus] = useState<SetupStatusPayload>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState("node");

  const refresh = async () => {
    setLoading(true);
    try {
      setStatus(await fetchSetupStatus());
      setError("");
    } catch (caught) {
      setStatus(undefined);
      setError(caught instanceof Error ? caught.message : "O companion não respondeu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const browserProbes = useMemo(() => [
    { label: "Interface", available: true, detail: location.origin },
    { label: "Microfone", available: Boolean(navigator.mediaDevices?.getUserMedia), detail: "API de captura do navegador" },
    { label: "STT do navegador", available: speechRecognitionSupported(), detail: "SpeechRecognition/webkitSpeechRecognition" },
    { label: "TTS do navegador", available: "speechSynthesis" in window, detail: "speechSynthesis" },
  ], []);

  const probes = useMemo(() => flattenSetupStatus(status), [status]);
  const selectedProbe = probes.find((probe) => probe.id === selectedTool);
  const summary = useMemo(() => probes.reduce<Record<SetupStage, number>>((counts, probe) => {
    counts[probe.stage] += 1;
    return counts;
  }, { "not-installed": 0, installed: 0, initialized: 0 }), [probes]);

  useEffect(() => {
    if (probes.length > 0 && !probes.some((probe) => probe.id === selectedTool)) setSelectedTool(probes[0].id);
  }, [probes, selectedTool]);

  const host = status
    ? `${getCompanionBaseUrl() || location.origin} · ${status.executionHost.platform}/${status.executionHost.architecture}`
    : getCompanionBaseUrl() || "127.0.0.1:3333";

  return (
    <LabFrame lab={labById.setup}>
      <div className={`setup-toolbar ${status ? "connected" : "disconnected"}`}>
        <div><Server size={20} /><span>Host efetivamente verificado</span><strong>{status ? host : "Companion ainda não verificado"}</strong></div>
        <Button onClick={refresh} busy={loading} variant="secondary"><RefreshCw size={16} /> Verificar novamente</Button>
      </div>

      <div className="deployment-explainer">
        <article><Cloud /><div><strong>Interface publicada</strong><p>A Vercel entrega somente o frontend. Ela não executa inferência nem recebe caminhos locais.</p></div></article>
        <article><Laptop /><div><strong>Companion em loopback</strong><p>Runtimes, modelos e arquivos permanecem no computador do usuário, acessíveis após pareamento.</p></div></article>
        <article><PackageCheck /><div><strong>Carregamento sob demanda</strong><p>Instalar uma ferramenta não carrega seu modelo. Cada laboratório inicia apenas o necessário.</p></div></article>
      </div>

      <ResultPanel label="ETAPA 1 · INSTALAR TUDO COM UM COMANDO">
        <p>Execute uma vez. O instalador percorre todas as ferramentas em sequência, pula o que já estiver reconhecido e não carrega modelos pesados. Em um checkout local, use <code>npm run setup</code>.</p>
        <CopyCommand action={INSTALL_ALL_ACTION} />
      </ResultPanel>

      <ResultPanel label="ETAPA 2 · INICIAR O AMBIENTE LEVE">
        <p>Depois da instalação, inicialize o Companion e os bridges em <code>127.0.0.1:3333</code>. O comando público aguarda a aplicação responder e a mantém ativa em segundo plano; use <code>voice-lab stop</code> para encerrar. Em desenvolvimento, <code>npm run companion</code> mantém os logs no terminal.</p>
        <CopyCommand action={BASE_COMPANION_ACTION} />
      </ResultPanel>

      {error && <StatusMessage title="Companion não reconhecido">{error}. Copie o comando base acima em um terminal do computador que executará os modelos.</StatusMessage>}

      <ResultPanel label="NAVEGADOR DO USUÁRIO">
        <div className="browser-probe-grid">
          {browserProbes.map((probe) => (
            <article className={probe.available ? "available" : "unavailable"} key={probe.label}>
              {probe.available ? <CheckCircle2 /> : <CircleX />}
              <div><strong>{probe.label}</strong><p>{probe.detail}</p></div>
              <span>{probe.available ? "Disponível" : "Indisponível"}</span>
            </article>
          ))}
        </div>
      </ResultPanel>

      <ResultPanel label="FERRAMENTAS NO HOST DO COMPANION">
        <div className="setup-summary" aria-label="Resumo do diagnóstico">
          <div className="summary-missing"><strong>{status ? summary["not-installed"] : "—"}</strong><span>não instaladas</span></div>
          <div className="summary-installed"><strong>{status ? summary.installed : "—"}</strong><span>instaladas, não inicializadas</span></div>
          <div className="summary-initialized"><strong>{status ? summary.initialized : "—"}</strong><span>inicializadas</span></div>
          <small>{status ? `Última sonda: ${new Date(status.checkedAt).toLocaleTimeString("pt-BR")}` : "Aguardando o companion"}</small>
        </div>
        {probes.length > 0 ? (
          <div className="setup-probe-grid">
            {probes.map((probe) => <ProbeCard key={probe.id} probe={probe} selected={selectedTool === probe.id} onSelect={() => setSelectedTool(probe.id)} />)}
          </div>
        ) : (
          <div className="empty-diagnostic"><CircleAlert /><div><strong>Sem diagnóstico do host local</strong><p>Inicie o companion e use “Verificar novamente”. Nenhum estado é presumido enquanto a sonda não responder.</p></div></div>
        )}
      </ResultPanel>

      <GuidePanel probe={selectedProbe} />

      <p className="cloud-note"><Cloud size={17} /> O status acima descreve o host que respondeu à sonda. Uma interface na Vercel não prova que uma ferramenta existe no computador até o companion local responder.</p>
    </LabFrame>
  );
}
