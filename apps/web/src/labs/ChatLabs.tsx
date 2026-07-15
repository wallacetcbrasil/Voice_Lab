import { AudioLines, Check, CircleHelp, Mic, Send, Square, Upload, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { Button, Field, Input, LongOperationNotice, Metric, ResultPanel, Select, StatusMessage, Textarea, Toggle } from "../components/Controls";
import { LmStudioModelPicker } from "../components/LmStudioModelPicker";
import { AudioInputGuide } from "../components/AudioInputGuide";
import { ModelLoadControl } from "../components/ModelLoadControl";
import { labById } from "./catalog";
import { ApiError, api, playBlob, postJson, streamChat } from "../services/apiClient";
import { getVoices, speak } from "../services/browserTtsClient";
import { createRecognition, speechRecognitionSupported } from "../services/speechRecognitionClient";
import { useExperiments } from "../state/ExperimentStore";

interface ChatState {
  response: string;
  error: string;
  busy: boolean;
  totalMs?: number;
  firstTokenMs?: number;
}

function extractText(payload: any) {
  return payload?.data?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.message?.content ?? payload?.data?.output_text ?? JSON.stringify(payload?.data ?? payload, null, 2);
}

function RuntimeChat({
  modeId,
  defaultUrl,
  title,
  showSystem = true,
  onSuccess,
  discoverLmStudioAudio = false,
  onModelSelection,
  onBaseUrlChange,
  defaultModel,
}: {
  modeId: string;
  defaultUrl: string;
  title: string;
  showSystem?: boolean;
  onSuccess?: (response: string) => void;
  discoverLmStudioAudio?: boolean;
  onModelSelection?: (selection: { modelId: string; baseUrl: string; ready: boolean } | null) => void;
  onBaseUrlChange?: (baseUrl: string) => void;
  defaultModel?: string;
}) {
  const [baseUrl, setBaseUrl] = useState(defaultUrl);
  const [model, setModel] = useState(discoverLmStudioAudio ? "" : (defaultModel ?? "ggml-org/Voxtral-Mini-3B-2507-GGUF"));
  const [modelReady, setModelReady] = useState(!discoverLmStudioAudio);
  const [system, setSystem] = useState("Você é um assistente local conciso. Responda em português.");
  const [language, setLanguage] = useState("pt-BR");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [message, setMessage] = useState("Explique em uma frase a diferença entre TTS e um LLM.");
  const [streaming, setStreaming] = useState(true);
  const [state, setState] = useState<ChatState>({ response: "", error: "", busy: false });
  const { addResult } = useExperiments();
  const languageNames: Record<string, string> = { "pt-BR": "Português do Brasil", "en-US": "English (US)", "es-ES": "Español", "fr-FR": "Français", "de-DE": "Deutsch" };
  const filteredVoices = useMemo(() => {
    const prefix = language.split("-")[0].toLowerCase();
    const matches = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
    return matches.length ? matches : voices;
  }, [language, voices]);

  useEffect(() => {
    const refresh = () => setVoices(getVoices());
    refresh();
    window.speechSynthesis?.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    const matching = filteredVoices.find((voice) => voice.voiceURI === voiceURI) || filteredVoices[0];
    setVoiceURI(matching?.voiceURI || "");
  }, [language, voices]);

  const send = async () => {
    if (!modelReady || !model) {
      setState({ response: "", error: "Pesquise, escolha e confirme uma quantização antes de enviar.", busy: false });
      return;
    }
    const started = performance.now();
    let firstToken: number | undefined;
    setState({ response: "", error: "", busy: true });
    const languageDirective = `Responda obrigatoriamente em ${languageNames[language] || language}.`;
    const messages = [...(showSystem ? [{ role: "system", content: `${system}\n${languageDirective}`.trim() }] : []), { role: "user", content: message }];
    try {
      let response = "";
      if (streaming) {
        await streamChat({ baseUrl, model, messages }, (token) => {
          if (firstToken === undefined) firstToken = Math.round(performance.now() - started);
          response += token;
          setState({ response, error: "", busy: true, firstTokenMs: firstToken });
        });
      } else {
        const payload = await postJson<any>("/api/lmstudio/chat", { baseUrl, model, messages });
        response = extractText(payload);
      }
      const total = Math.round(performance.now() - started);
      setState({ response, error: "", busy: false, totalMs: total, firstTokenMs: firstToken });
      onSuccess?.(response);
      addResult({
        modeId, modeName: title, runtime: modeId === "qwen-llama" ? "llama.cpp" : "LM Studio", model,
        stt: "—", tts: "—", status: "success", totalMs: total, firstTokenMs: firstToken,
        acceptsVoice: false, generatesVoice: false, notes: [streaming ? "Streaming textual observado" : "Resposta não-streaming"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      setState({ response: "", error: error instanceof ApiError && error.hint ? `${message} — ${error.hint}` : message, busy: false });
      addResult({ modeId, modeName: title, runtime: baseUrl, model, stt: "—", tts: "—", status: "error", acceptsVoice: false, generatesVoice: false, notes: [message] });
    }
  };

  return (
    <>
      <div className="form-grid">
        <Field label="Base URL">
          <Input value={baseUrl} onChange={(event) => {
            setBaseUrl(event.target.value);
            onBaseUrlChange?.(event.target.value);
            if (discoverLmStudioAudio) {
              setModel("");
              setModelReady(false);
              onModelSelection?.(null);
            }
          }} />
        </Field>
        {!discoverLmStudioAudio && <Field label="Model ID"><Input value={model} onChange={(event) => setModel(event.target.value)} /></Field>}
      </div>
      {discoverLmStudioAudio && (
        <LmStudioModelPicker
          baseUrl={baseUrl}
          onSelection={(selection) => {
            setModel(selection?.modelId || "");
            setModelReady(Boolean(selection?.ready));
            onModelSelection?.(selection ? { modelId: selection.modelId, baseUrl, ready: selection.ready } : null);
          }}
        />
      )}
      {showSystem && <Field label="System Prompt"><Textarea rows={3} value={system} onChange={(event) => setSystem(event.target.value)} /></Field>}
      <div className="form-grid">
        <Field label="Idioma da resposta e da leitura">
          <Select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="pt-BR">Português do Brasil</option>
            <option value="en-US">English (US)</option>
            <option value="es-ES">Español</option>
            <option value="fr-FR">Français</option>
            <option value="de-DE">Deutsch</option>
          </Select>
        </Field>
        <Field label="Voz do navegador" hint={`${filteredVoices.length} voz(es) compatível(is) encontrada(s)`}>
          <Select value={voiceURI} onChange={(event) => setVoiceURI(event.target.value)}>
            {filteredVoices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Mensagem"><Textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} /></Field>
      <div className="action-row">
        <Button onClick={send} busy={state.busy} disabled={!message.trim() || !modelReady || !model}><Send size={16} /> Enviar</Button>
        <Button variant="secondary" onClick={() => state.response && speak(state.response, { lang: language, voiceURI })} disabled={!state.response}><Volume2 size={16} /> Ler resposta</Button>
        <Toggle checked={streaming} onChange={setStreaming} label="Streaming textual" />
      </div>
      <LongOperationNotice active={state.busy} title="Gerando resposta" detail="O modelo já foi confirmado como carregado; este contador mede apenas o tempo da inferência atual." />
      {state.error && <StatusMessage title="Runtime não respondeu">{state.error}</StatusMessage>}
      <div className="metric-row">
        <Metric label="Primeiro token" value={state.firstTokenMs === undefined ? "—" : `${state.firstTokenMs} ms`} />
        <Metric label="Resposta completa" value={state.totalMs === undefined ? "—" : `${state.totalMs} ms`} />
        <Metric label="Voz nativa" value="Não medida" />
      </div>
      <ResultPanel label="RESPOSTA TEXTUAL"><p className="response-text">{state.response || "A resposta aparecerá aqui. Nenhuma voz é gerada pelo LM Studio neste teste."}</p></ResultPanel>
    </>
  );
}

export function LmChatLab() {
  return <LabFrame lab={labById["lm-chat"]}><RuntimeChat modeId="lm-chat" title="LM Studio Chat + TTS" defaultUrl="http://localhost:1234/v1" discoverLmStudioAudio /></LabFrame>;
}

export function TurnVoiceLab() {
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("Pronto");
  const [captureMs, setCaptureMs] = useState<number>();
  const [generationMs, setGenerationMs] = useState<number>();
  const [audioMs, setAudioMs] = useState<number>();
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [model, setModel] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const started = useRef(0);
  const recognition = useRef<ReturnType<typeof createRecognition> | null>(null);
  const { addResult } = useExperiments();

  const ask = async (text: string) => {
    const generationStart = performance.now();
    setPhase("Modelo pensando"); setError("");
    try {
      const payload = await postJson<any>("/api/lmstudio/chat", {
        baseUrl,
        model,
        messages: [{ role: "system", content: "Responda de forma curta em português." }, { role: "user", content: text }],
      });
      const answer = extractText(payload);
      const gen = Math.round(performance.now() - generationStart);
      setGenerationMs(gen); setResponse(answer); setPhase("Preparando áudio");
      const audioStart = performance.now();
      speak(answer, {
        onStart: () => { setAudioMs(Math.round(performance.now() - audioStart)); setPhase("Falando"); },
        onEnd: () => setPhase("Concluído"),
      });
      addResult({
        modeId: "turn-voice", modeName: "Voz por Turnos", runtime: "LM Studio", model: "modelo configurado",
        stt: "SpeechRecognition", tts: "speechSynthesis", status: "success", totalMs: (captureMs || 0) + gen,
        acceptsVoice: true, generatesVoice: true, notes: ["Pipeline por turnos; voz do navegador"],
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha no pipeline"); setPhase("Erro");
    }
  };

  const listen = () => {
    if (!speechRecognitionSupported()) return setError("SpeechRecognition indisponível. Use Chrome/Edge ou Whisper local.");
    setTranscript(""); setResponse(""); setError(""); setPhase("Ouvindo"); started.current = performance.now();
    recognition.current = createRecognition({
      continuous: false,
      onPartial: setTranscript,
      onFinal: (text) => {
        const measured = Math.round(performance.now() - started.current);
        setCaptureMs(measured); setTranscript(text); void ask(text);
      },
      onError: setError,
      onEnd: () => setPhase((current) => current === "Ouvindo" ? "Aguardando transcrição" : current),
    });
    recognition.current.start();
  };

  return (
    <LabFrame lab={labById["turn-voice"]}>
      <Field label="Base URL do LM Studio"><Input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setModel(""); setModelReady(false); }} /></Field>
      <LmStudioModelPicker
        baseUrl={baseUrl}
        onSelection={(selection) => {
          setModel(selection?.modelId || "");
          setModelReady(Boolean(selection?.ready));
        }}
      />
      <div className={`mic-stage ${phase === "Ouvindo" ? "is-listening" : ""}`}>
        <div className="mic-orbit"><span /><button disabled={!modelReady} onPointerDown={listen} onPointerUp={() => recognition.current?.stop()} aria-label="Segure para falar"><Mic /></button></div>
        <div><strong>{phase === "Ouvindo" ? "Ouvindo…" : "Voz por turnos"}</strong><p>{modelReady ? "Segure o microfone, fale naturalmente e solte para enviar ao LM Studio." : "Confirme o modelo e a quantização antes de iniciar."}</p><div className="phase-display"><span className="phase-dot" />{phase}</div></div>
      </div>
      <div className="results-grid">
        <ResultPanel label="VOCÊ DISSE" muted><p>{transcript || "Aguardando o seu turno…"}</p></ResultPanel>
        <ResultPanel label="ASSISTENTE"><p>{response || "A resposta textual aparecerá antes da fala."}</p></ResultPanel>
      </div>
      {error && <StatusMessage title="Pipeline interrompido">{error}</StatusMessage>}
      <div className="metric-row metrics-five">
        <Metric label="Captura/STT" value={captureMs === undefined ? "—" : `${captureMs} ms`} />
        <Metric label="Primeiro token" value="n/d*" />
        <Metric label="Resposta" value={generationMs === undefined ? "—" : `${generationMs} ms`} />
        <Metric label="Início áudio" value={audioMs === undefined ? "—" : `${audioMs} ms`} />
        <Metric label="Total aprox." value={generationMs === undefined ? "—" : `${(captureMs || 0) + generationMs + (audioMs || 0)} ms`} />
      </div>
      <p className="footnote">* Primeiro token exige streaming; a rota por turnos usa resposta completa para simplificar a medição.</p>
    </LabFrame>
  );
}

type CapabilityState = "untested" | "yes" | "no";

function Capability({ label, state }: { label: string; state: CapabilityState }) {
  const Icon = state === "yes" ? Check : state === "no" ? X : CircleHelp;
  return <div className={`capability capability-${state}`}><Icon size={15} /><span>{label}</span><strong>{state === "yes" ? "Sim" : state === "no" ? "Não" : "Não medido"}</strong></div>;
}

export function QwenLmLab() {
  const [textOk, setTextOk] = useState<CapabilityState>("untested");
  const [streamOk, setStreamOk] = useState<CapabilityState>("untested");
  const [audioState, setAudioState] = useState<CapabilityState>("untested");
  const [audioError, setAudioError] = useState("");
  const [file, setFile] = useState<File>();
  const [selection, setSelection] = useState<{ modelId: string; baseUrl: string; ready: boolean } | null>(null);

  const tryAudio = async () => {
    if (!file) return;
    setAudioError("");
    const data = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    data.forEach((byte) => { binary += String.fromCharCode(byte); });
    try {
      await postJson("/api/lmstudio/chat", {
        baseUrl: selection?.baseUrl,
        model: selection?.modelId,
        messages: [{ role: "user", content: [
          { type: "text", text: "Transcreva ou descreva este áudio." },
          { type: "input_audio", input_audio: { data: btoa(binary), format: file.name.split(".").pop() || "wav" } },
        ] }],
      });
      setAudioState("yes");
    } catch (error) {
      setAudioState("no"); setAudioError(error instanceof Error ? error.message : "Áudio recusado pelo runtime");
    }
  };

  return (
    <LabFrame lab={labById["qwen-lm"]}>
      <StatusMessage type="info" title="Aviso técnico">Mesmo sendo Omni/multimodal, o LM Studio pode não expor todos os recursos nativos de áudio. Este teste mede o runtime atual.</StatusMessage>
      <RuntimeChat
        modeId="qwen-lm"
        title="Modelo multimodal no LM Studio"
        defaultUrl="http://localhost:1234/v1"
        discoverLmStudioAudio
        onModelSelection={setSelection}
        onSuccess={() => { setTextOk("yes"); setStreamOk("yes"); }}
      />
      <div className="upload-test">
        <Field label="Tentativa de áudio nativo" hint="O arquivo fica na memória e é enviado apenas ao backend local.">
          <Input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} />
        </Field>
        <Button variant="secondary" onClick={tryAudio} disabled={!file || !selection?.ready}><Upload size={16} /> Testar áudio no runtime</Button>
      </div>
      {audioError && <StatusMessage title="Áudio não aceito">{audioError} O fallback da aba Voz por Turnos continua disponível.</StatusMessage>}
      <div className="capability-grid">
        <Capability label="Modelo carregou" state={textOk} /><Capability label="Aceita texto" state={textOk} />
        <Capability label="Aceita imagem" state="untested" /><Capability label="Aceita áudio" state={audioState} />
        <Capability label="Gera texto" state={textOk} /><Capability label="Gera áudio nativo" state="no" />
        <Capability label="Permite streaming" state={streamOk} /><Capability label="Permite interrupção" state="no" />
      </div>
    </LabFrame>
  );
}

export function QwenLlamaLab() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:8080/v1");
  return (
    <LabFrame lab={labById["qwen-llama"]}>
      <StatusMessage type="info" title="Comparação controlada">Use a mesma quantização e contexto do teste no LM Studio. O GGUF atual lista áudio de entrada, mas não geração de áudio.</StatusMessage>
      <StatusMessage type="info" title="Instalação centralizada">Use a primeira aba, Instalação e Diagnóstico, para instalar o llama.cpp e verificar binário, servidor e endpoint.</StatusMessage>
      <RuntimeChat modeId="qwen-llama" title="Modelo multimodal via llama.cpp" defaultUrl={baseUrl} onBaseUrlChange={setBaseUrl} />
    </LabFrame>
  );
}

export function QwenPythonLab() {
  const [prompt, setPrompt] = useState("Apresente-se em uma frase.");
  const [mode, setMode] = useState("text");
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [latency, setLatency] = useState<number>();

  const run = async () => {
    setBusy(true); setError(""); setResult("");
    const started = performance.now();
    try {
      if (mode === "text") {
        const response = await postJson<any>("/api/transformers/text", { prompt });
        setResult(extractText(response));
      } else {
        if (!file) throw new Error("Selecione um áudio.");
        const form = new FormData(); form.append("audio", file); form.append("prompt", prompt);
        const response = await api<any>(mode === "audio" ? "/api/transformers/audio" : "/api/transformers/audio-to-audio", { method: "POST", body: form });
        if (response instanceof Blob) { playBlob(response); setResult("Áudio nativo recebido e reproduzido."); }
        else setResult(extractText(response));
      }
      setLatency(Math.round(performance.now() - started));
    } catch (error) {
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha");
    } finally { setBusy(false); }
  };

  return (
    <LabFrame lab={labById["qwen-python"]}>
      <StatusMessage type="info" title="Checkpoint recomendado">O exemplo desta bancada é mistralai/Voxtral-Mini-3B-2507: áudio ou texto entram e texto sai. Use um TTS separado para obter fala.</StatusMessage>
      <ModelLoadControl engine="transformers" label="Checkpoint multimodal Transformers" onReady={setModelReady} />
      <div className="form-grid">
        <Field label="Teste"><Select value={mode} onChange={(event) => setMode(event.target.value)}><option value="text">texto → texto</option><option value="audio">áudio → texto</option></Select></Field>
        {mode !== "text" && <Field label="Áudio de entrada (o modelo vai ouvir)"><Input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} /></Field>}
      </div>
      {mode !== "text" && <AudioInputGuide kind="input" onRecorded={setFile} />}
      <Field label="Prompt"><Textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></Field>
      <div className="action-row"><Button onClick={run} busy={busy} disabled={!modelReady}><AudioLines size={16} /> Executar no backend Python</Button><Metric label="Tempo total" value={latency ? `${latency} ms` : "—"} /></div>
      <LongOperationNotice active={busy} title="Executando inferência multimodal" detail="O checkpoint foi carregado separadamente; este tempo mede processamento do prompt/áudio e geração textual." />
      {error && <StatusMessage title="Backend Python indisponível">{error}</StatusMessage>}
      <ResultPanel><p>{result || "O resultado nativo aparecerá aqui quando o extra Python estiver instalado."}</p></ResultPanel>
    </LabFrame>
  );
}
