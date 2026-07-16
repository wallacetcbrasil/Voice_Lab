import { Mic, PhoneOff, Radio, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { LmStudioModelPicker } from "../components/LmStudioModelPicker";
import { Button, Field, Input, Metric, Range, ResultPanel, Select, StatusMessage } from "../components/Controls";
import { companionWebSocketUrl, streamChat, postJson } from "../services/apiClient";
import { getVoices, speak, stopSpeaking } from "../services/browserTtsClient";
import { createRecognition, speechRecognitionSupported } from "../services/speechRecognitionClient";
import { useExperiments } from "../state/ExperimentStore";
import { labById } from "./catalog";

interface SessionResponse {
  data: { id: string };
  websocketPath: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const languageOptions = [
  ["pt-BR", "Português (Brasil)"],
  ["pt-PT", "Português (Portugal)"],
  ["en-US", "English (US)"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
] as const;

export function RealtimeLab() {
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<ReturnType<typeof createRecognition> | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const animation = useRef<number>(0);
  const sentAt = useRef(new Map<number, number>());
  const sequence = useRef(0);
  const activeRef = useRef(false);
  const processing = useRef(false);
  const turnId = useRef(0);
  const energyRef = useRef(0);
  const thresholdRef = useRef(0.08);
  const conversation = useRef<ChatMessage[]>([]);
  const completedTurnsRef = useRef(0);
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("desconectado");
  const [mode, setMode] = useState<"assistant" | "transport">("assistant");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [model, setModel] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [language, setLanguage] = useState("pt-BR");
  const [voiceURI, setVoiceURI] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chunkMs, setChunkMs] = useState(500);
  const [threshold, setThresholdState] = useState(0.08);
  const [energy, setEnergy] = useState(0);
  const [vad, setVad] = useState<"silêncio" | "fala">("silêncio");
  const [chunks, setChunks] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [turnLatency, setTurnLatency] = useState<number>();
  const [events, setEvents] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [mime, setMime] = useState("");
  const [bargeIns, setBargeIns] = useState(0);
  const [completedTurns, setCompletedTurns] = useState(0);
  const { addResult } = useExperiments();

  const logEvent = useCallback((message: string) => {
    setEvents((current) => [`${new Date().toLocaleTimeString()}  ${message}`, ...current].slice(0, 30));
  }, []);

  const releaseResources = useCallback((closeSocket = true) => {
    activeRef.current = false;
    processing.current = false;
    turnId.current += 1;
    chatAbort.current?.abort();
    chatAbort.current = null;
    try { recognition.current?.abort(); } catch { /* reconhecimento já encerrado */ }
    recognition.current = null;
    stopSpeaking();
    if (recorder.current?.state && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    const currentSocket = socket.current;
    socket.current = null;
    if (closeSocket && currentSocket && currentSocket.readyState < WebSocket.CLOSING) currentSocket.close(1000, "Sessão encerrada pelo usuário");
    if (animation.current) cancelAnimationFrame(animation.current);
    animation.current = 0;
    void audioContext.current?.close();
    audioContext.current = null;
    sentAt.current.clear();
    setActive(false);
    setConnecting(false);
    setEnergy(0);
    setVad("silêncio");
  }, []);

  useEffect(() => {
    const refresh = () => {
      const available = getVoices();
      setVoices(available);
      setVoiceURI((current) => current || available.find((voice) => voice.lang.toLowerCase().startsWith("pt"))?.voiceURI || available[0]?.voiceURI || "");
    };
    refresh();
    window.speechSynthesis?.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", refresh);
  }, []);

  const filteredVoices = useMemo(() => {
    const prefix = language.split("-")[0].toLowerCase();
    const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
    return matching.length ? matching : voices;
  }, [language, voices]);

  useEffect(() => {
    if (filteredVoices.length && !filteredVoices.some((voice) => voice.voiceURI === voiceURI)) {
      setVoiceURI(filteredVoices[0].voiceURI);
    }
  }, [filteredVoices, voiceURI]);

  const setThreshold = (value: number) => {
    thresholdRef.current = value;
    setThresholdState(value);
  };

  const handleModelSelection = useCallback((selection: { modelId: string; ready: boolean } | null) => {
    setModel(selection?.modelId || "");
    setModelReady(Boolean(selection?.ready));
  }, []);

  const monitorEnergy = (media: MediaStream) => {
    const context = new AudioContext();
    audioContext.current = context;
    const source = context.createMediaStreamSource(media);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const update = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      energyRef.current = rms;
      setEnergy(rms);
      setVad(rms > thresholdRef.current ? "fala" : "silêncio");
      animation.current = requestAnimationFrame(update);
    };
    update();
  };

  const interruptOutput = useCallback(() => {
    const speaking = Boolean(window.speechSynthesis?.speaking);
    const generating = processing.current;
    if (!speaking && !generating) return;
    chatAbort.current?.abort();
    chatAbort.current = null;
    stopSpeaking();
    turnId.current += 1;
    processing.current = false;
    setBargeIns((current) => current + 1);
    setStatus("interrompido · ouvindo");
    logEvent(`Barge-in local: ${speaking ? "áudio" : "geração"} interrompido por nova fala`);
  }, [logEvent]);

  const respond = useCallback(async (text: string) => {
    if (!text.trim() || processing.current || !activeRef.current) return;
    processing.current = true;
    const currentTurn = ++turnId.current;
    const started = performance.now();
    setTranscript(text);
    setPartial("");
    setAnswer("");
    setError("");
    setStatus("modelo pensando");
    logEvent(`Transcrição final: “${text}”`);

    const languageLabel = languageOptions.find(([code]) => code === language)?.[1] || language;
    const history = conversation.current.slice(-8);
    const messages: ChatMessage[] = [
      { role: "system", content: `Você é um assistente de voz local. Responda de forma curta e natural em ${languageLabel}.` },
      ...history,
      { role: "user", content: text },
    ];
    let complete = "";
    const controller = new AbortController();
    chatAbort.current = controller;
    try {
      await streamChat({ baseUrl, model, messages }, (token) => {
        if (currentTurn !== turnId.current) return;
        complete += token;
        setAnswer(complete);
        setStatus("resposta incremental");
      }, { signal: controller.signal });
      if (chatAbort.current === controller) chatAbort.current = null;
      if (currentTurn !== turnId.current || !activeRef.current) return;
      if (!complete.trim()) throw new Error("O modelo terminou sem produzir texto.");
      const elapsed = Math.round(performance.now() - started);
      setTurnLatency(elapsed);
      conversation.current = [...history, { role: "user", content: text }, { role: "assistant", content: complete }];
      setStatus("TTS aguardando início");
      logEvent(`Resposta completa em ${elapsed} ms; enviada ao TTS do navegador`);
      speak(complete, {
        lang: language,
        voiceURI,
        onStart: () => {
          if (currentTurn !== turnId.current || !activeRef.current) return;
          const audioLatency = Math.round(performance.now() - started);
          setTurnLatency(audioLatency);
          setStatus("falando");
          logEvent(`TTS do navegador iniciou a reprodução em ${audioLatency} ms`);
        },
        onEnd: () => {
          if (currentTurn === turnId.current && activeRef.current) {
            processing.current = false;
            completedTurnsRef.current += 1;
            setCompletedTurns(completedTurnsRef.current);
            setStatus("conectado · ouvindo");
            logEvent("Resposta falada; aguardando a próxima frase");
          }
        },
      });
    } catch (caught) {
      if (chatAbort.current === controller) chatAbort.current = null;
      if (currentTurn !== turnId.current) return;
      processing.current = false;
      const message = caught instanceof Error ? caught.message : "Falha ao consultar o LM Studio.";
      setError(message);
      setStatus("erro · ainda ouvindo");
      logEvent(`Erro no turno: ${message}`);
    }
  }, [baseUrl, language, logEvent, model, voiceURI]);

  const beginRecognition = useCallback(() => {
    if (mode !== "assistant") return;
    recognition.current = createRecognition({
      language,
      continuous: true,
      onPartial: (text) => {
        interruptOutput();
        setPartial(text);
        setStatus("fala sendo transcrita");
      },
      onFinal: (text) => {
        interruptOutput();
        void respond(text);
      },
      onError: (message) => {
        if (message === "no-speech" || message === "aborted") return;
        setError(`STT do navegador: ${message}`);
        logEvent(`SpeechRecognition: ${message}`);
        if (["not-allowed", "service-not-allowed", "audio-capture"].includes(message)) {
          setStatus("STT indisponível");
          releaseResources();
        }
      },
      onEnd: () => {
        if (activeRef.current && mode === "assistant") {
          window.setTimeout(() => {
            if (!activeRef.current) return;
            try {
              recognition.current?.start();
            } catch {
              // O navegador pode ainda estar encerrando a instância anterior.
            }
          }, 250);
        }
      },
    });
    recognition.current.start();
    logEvent(`STT contínuo iniciado em ${language}`);
  }, [interruptOutput, language, logEvent, mode, releaseResources, respond]);

  const start = async () => {
    setError("");
    setChunks(0);
    setBytes(0);
    setLatencies([]);
    setTurnLatency(undefined);
    setTranscript("");
    setPartial("");
    setAnswer("");
    setBargeIns(0);
    setCompletedTurns(0);
    completedTurnsRef.current = 0;
    sequence.current = 0;
    conversation.current = [];
    if (mode === "assistant" && !speechRecognitionSupported()) {
      setError("SpeechRecognition indisponível. Use Chrome/Edge para o modo assistente ou escolha o modo de transporte.");
      return;
    }
    setConnecting(true);
    setStatus("criando sessão");
    try {
      const session = await postJson<SessionResponse>("/api/realtime/session", { chunkMs, mode });
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      stream.current = media;
      monitorEnergy(media);
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(media, preferred ? { mimeType: preferred } : undefined);
      recorder.current = mediaRecorder;
      setMime(mediaRecorder.mimeType || "padrão do navegador");
      const ws = new WebSocket(companionWebSocketUrl(session.websocketPath));
      socket.current = ws;
      let transportStarted = false;
      ws.onopen = () => {
        setStatus("WebSocket aberto · aguardando confirmação");
        logEvent("WebSocket aberto; aguardando confirmação do Companion");
      };
      ws.onerror = () => {
        setError("Falha no WebSocket local.");
        logEvent("WebSocket informou erro de transporte");
      };
      ws.onclose = (event) => {
        if (socket.current !== ws) return;
        socket.current = null;
        releaseResources(false);
        setStatus("conexão encerrada");
        setError(`WebSocket encerrado${event.code ? ` (código ${event.code})` : ""}.`);
        logEvent(`WebSocket encerrado pelo Companion · código ${event.code}`);
      };
      ws.onmessage = (event) => {
        let data: { type?: string; sequence?: number; chunksReceived?: number; totalBytes?: number; message?: string };
        try {
          data = JSON.parse(event.data);
        } catch {
          setError("O Companion enviou um evento WebSocket inválido.");
          return;
        }
        if (data.type === "ready" && !transportStarted) {
          try {
            transportStarted = true;
            mediaRecorder.start(chunkMs);
            activeRef.current = true;
            setConnecting(false);
            setActive(true);
            setStatus(mode === "assistant" ? "conectado · ouvindo" : "transporte conectado");
            logEvent("Companion confirmou a sessão; captura em chunks iniciada");
            if (mode === "assistant") beginRecognition();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a captura contínua.");
            releaseResources();
          }
          return;
        }
        const acknowledgedSequence = data.sequence;
        if (data.type === "chunk-ack" && acknowledgedSequence !== undefined && sentAt.current.has(acknowledgedSequence)) {
          const latency = Math.round(performance.now() - sentAt.current.get(acknowledgedSequence)!);
          setLatencies((current) => [...current.slice(-49), latency]);
          sentAt.current.delete(acknowledgedSequence);
        }
        if (data.type === "chunk-ack") {
          setChunks(data.chunksReceived || 0);
          setBytes(data.totalBytes || 0);
          if ((data.chunksReceived || 0) % 5 === 0) logEvent(`${data.chunksReceived} chunks confirmados pelo backend`);
        }
        if (data.type === "warning") {
          setError(data.message || "O Companion rejeitou um evento da sessão.");
          logEvent(data.message || "Aviso recebido do Companion");
        }
      };
      mediaRecorder.ondataavailable = async (event) => {
        if (!event.data.size || ws.readyState !== WebSocket.OPEN) return;
        sequence.current += 1;
        const current = sequence.current;
        sentAt.current.set(current, performance.now());
        ws.send(JSON.stringify({
          type: "chunk-meta",
          sequence: current,
          clientAt: Date.now(),
          energy: energyRef.current,
          vad: energyRef.current > thresholdRef.current ? "fala" : "silêncio",
        }));
        ws.send(await event.data.arrayBuffer());
      };
      mediaRecorder.onerror = () => {
        setError("MediaRecorder não conseguiu codificar o áudio capturado.");
        setStatus("erro de captura");
        releaseResources();
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar microfone/sessão.");
      releaseResources();
      setStatus("desconectado");
    }
  };

  const stop = (record = true) => {
    if (record && chunks > 0) {
      const average = Math.round(latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length));
      const assistantCompleted = mode === "assistant" && completedTurnsRef.current > 0;
      addResult({
        modeId: "realtime",
        modeName: "Realtime/Live Experimental",
        runtime: mode === "assistant" ? "WebSocket + LM Studio" : "WebSocket diagnóstico",
        model: mode === "assistant" ? model : "nenhum",
        stt: mode === "assistant" ? "SpeechRecognition" : "não conectado",
        tts: mode === "assistant" ? "speechSynthesis" : "não conectado",
        status: mode === "transport" || assistantCompleted ? "success" : "partial",
        totalMs: turnLatency || average,
        acceptsVoice: true,
        generatesVoice: assistantCompleted,
        notes: [`${chunks} chunks transmitidos`, "VAD RMS no navegador", mode === "assistant" ? `${completedTurnsRef.current} turno(s) respondido(s)` : "Transporte e ACKs verificados", "Não é full-duplex"],
      });
    }
    releaseResources();
    setStatus("desconectado");
  };

  useEffect(() => () => releaseResources(), [releaseResources]);

  const average = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : undefined;
  const canStart = !active && !connecting && (mode === "transport" || (modelReady && Boolean(model)));

  return (
    <LabFrame lab={labById.realtime}>
      <StatusMessage type="info" title="Pipeline executável por turnos — não é full-duplex">
        No modo assistente, o navegador transcreve cada frase, o LM Studio gera texto incremental e o navegador fala a resposta. A captura é contínua, mas cada resposta ainda é um turno STT → LLM → TTS.
      </StatusMessage>
      {mode === "assistant" && <StatusMessage type="info" title="Privacidade do STT do navegador">
        Os chunks WebSocket permanecem no Companion local. SpeechRecognition, porém, pode enviar a fala ao fornecedor do navegador; use este modo somente após aceitar essa possibilidade.
      </StatusMessage>}

      <div className="form-grid">
        <Field label="Modo da sessão">
          <Select value={mode} onChange={(event) => setMode(event.target.value as "assistant" | "transport")} disabled={active}>
            <option value="assistant">Assistente por turnos curtos (responde)</option>
            <option value="transport">Somente transporte/VAD (diagnóstico)</option>
          </Select>
        </Field>
        <Field label="Base URL do LM Studio">
          <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={active || mode === "transport"} />
        </Field>
      </div>

      {mode === "assistant" && (
        <>
          <LmStudioModelPicker
            baseUrl={baseUrl}
            onSelection={handleModelSelection}
          />
          <div className="form-grid">
            <Field label="Idioma da fala e da resposta">
              <Select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={active}>
                {languageOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Voz do navegador" hint={`${filteredVoices.length} voz(es) disponíveis`}>
              <Select value={voiceURI} onChange={(event) => setVoiceURI(event.target.value)} disabled={active}>
                {filteredVoices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}

      <div className={`realtime-stage ${active ? "active" : ""}`}>
        <div className="signal-visual" aria-label={`Energia ${energy.toFixed(3)}`}>
          {Array.from({ length: 28 }).map((_, index) => (
            <i key={index} style={{ height: `${Math.max(5, Math.min(100, energy * 900 * (0.45 + ((index * 7) % 10) / 10)))}%` }} />
          ))}
        </div>
        <div className="realtime-state">
          <span className={`vad-light vad-${vad}`} />
          <div><strong>{vad === "fala" ? "Fala detectada" : "Silêncio / ruído baixo"}</strong><p>{status} · energia {energy.toFixed(3)}</p></div>
        </div>
      </div>

      {mode === "assistant" && (
        <div className="realtime-bottom">
          <ResultPanel label="VOCÊ DISSE"><p className="response-text">{partial || transcript || "A transcrição aparecerá aqui."}</p></ResultPanel>
          <ResultPanel label="RESPOSTA INCREMENTAL"><p className="response-text">{answer || "A resposta do LM Studio aparecerá aqui e será falada."}</p></ResultPanel>
        </div>
      )}

      <div className="form-grid">
        <Field label="Tamanho do chunk">
          <Select value={chunkMs} onChange={(event) => setChunkMs(Number(event.target.value))} disabled={active}>
            <option value={250}>250 ms</option><option value={500}>500 ms</option><option value={1000}>1000 ms</option>
          </Select>
        </Field>
        <Range label="Limiar VAD" value={threshold} min={0.01} max={0.3} step={0.01} onChange={setThreshold} />
      </div>
      <div className="action-row">
        <Button onClick={start} disabled={!canStart}><Mic size={16} /> {connecting ? "Conectando…" : "Iniciar sessão"}</Button>
        <Button variant="danger" onClick={() => stop()} disabled={!active && !connecting}><PhoneOff size={16} /> Encerrar</Button>
        <span className="codec-label"><Radio size={14} /> {mime || "codec ainda não negociado"}</span>
      </div>
      {mode === "assistant" && !modelReady && <StatusMessage type="info" title="Escolha um modelo antes de iniciar">O Voice Lab não carregará vários modelos. Selecione uma única quantização acima e confirme-a apenas se ainda não estiver carregada.</StatusMessage>}
      {error && <StatusMessage title="Sessão com problema">{error}</StatusMessage>}
      <div className="metric-row">
        <Metric label="Chunks recebidos" value={chunks} accent={active} />
        <Metric label="Dados enviados" value={bytes ? `${Math.ceil(bytes / 1024)} KB` : "—"} />
        <Metric label="ACK médio" value={average ? `${average} ms` : "—"} />
        <Metric label="Último turno" value={turnLatency ? `${turnLatency} ms` : "—"} />
      </div>
      <div className="realtime-bottom">
        <ResultPanel label="CHECKLIST REALTIME">
          <div className="realtime-checklist">
            <span className={chunks > 0 ? "done" : ""}>Streaming de entrada</span>
            <span className={answer ? "done" : ""}>Resposta textual incremental</span>
            <span className={chunks > 0 ? "done" : ""}>VAD RMS</span>
            <span className={bargeIns > 0 ? "done" : ""}>Barge-in observado ({bargeIns})</span>
            <span className={conversation.current.length ? "done" : ""}>Sessão/memória</span>
            <span>RAG</span>
            <span className={turnLatency ? "done" : ""}>Latência medida</span>
            <span className={completedTurns > 0 ? "done" : ""}>TTS concluído ({completedTurns})</span>
          </div>
        </ResultPanel>
        <ResultPanel label="EVENTOS DA SESSÃO" muted>
          <div className="event-log">{events.length ? events.map((event, index) => <code key={`${event}-${index}`}>{event}</code>) : <p>Nenhum evento.</p>}</div>
        </ResultPanel>
      </div>
      <div className="architecture-strip">
        <Waves size={18} /><span>Microfone contínuo</span><b>→</b><span>VAD + chunks</span><b>→</b>
        <span className={mode === "assistant" ? "" : "missing"}>STT navegador</span><b>→</b>
        <span className={mode === "assistant" ? "" : "missing"}>LM Studio incremental</span><b>→</b>
        <span className={mode === "assistant" ? "" : "missing"}>TTS navegador</span>
      </div>
    </LabFrame>
  );
}
