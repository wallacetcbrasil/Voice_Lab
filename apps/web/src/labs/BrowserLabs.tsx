import { Mic, MicOff, Pause, Play, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { Button, Field, Metric, Range, ResultPanel, Select, StatusMessage, Textarea } from "../components/Controls";
import { labById } from "./catalog";
import { getVoices, speak, stopSpeaking } from "../services/browserTtsClient";
import { createRecognition, speechRecognitionSupported } from "../services/speechRecognitionClient";
import { useExperiments } from "../state/ExperimentStore";

export function TtsBrowserLab() {
  const [text, setText] = useState("Olá! Este áudio vem do navegador, não de um modelo conversacional.");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [latency, setLatency] = useState<number>();
  const [speaking, setSpeaking] = useState(false);
  const { addResult } = useExperiments();

  useEffect(() => {
    const refresh = () => {
      const available = getVoices();
      setVoices(available);
      if (!voice && available[0]) setVoice(available[0].voiceURI);
    };
    refresh();
    window.speechSynthesis?.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", refresh);
  }, [voice]);

  const handleSpeak = () => {
    const started = performance.now();
    speak(text, {
      voiceURI: voice, rate, pitch, volume,
      onStart: () => {
        const measured = Math.round(performance.now() - started);
        setLatency(measured);
        setSpeaking(true);
        addResult({
          modeId: "tts-browser", modeName: "TTS Simples", runtime: "Browser", model: voices.find((v) => v.voiceURI === voice)?.name || "voz do sistema",
          stt: "—", tts: "speechSynthesis", status: "success", totalMs: measured, acceptsVoice: false, generatesVoice: true, notes: ["Áudio produzido pelo navegador"],
        });
      },
      onEnd: () => setSpeaking(false),
    });
  };

  return (
    <LabFrame lab={labById["tts-browser"]}>
      <div className="form-grid">
        <Field label="Texto para sintetizar"><Textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} /></Field>
        <Field label="Voz disponível" hint={`${voices.length} vozes encontradas no sistema`}>
          <Select value={voice} onChange={(event) => setVoice(event.target.value)}>{voices.map((item) => <option value={item.voiceURI} key={item.voiceURI}>{item.name} · {item.lang}</option>)}</Select>
        </Field>
      </div>
      <div className="range-grid">
        <Range label="Velocidade" value={rate} min={0.5} max={2} step={0.1} onChange={setRate} />
        <Range label="Pitch" value={pitch} min={0.5} max={2} step={0.1} onChange={setPitch} />
        <Range label="Volume" value={volume} min={0} max={1} step={0.1} onChange={setVolume} />
      </div>
      <div className="action-row">
        <Button onClick={handleSpeak} disabled={!text.trim() || voices.length === 0}><Volume2 size={17} /> Falar</Button>
        <Button variant="secondary" onClick={() => { stopSpeaking(); setSpeaking(false); }}><Square size={15} /> Parar</Button>
        <Metric label="Início do áudio" value={latency === undefined ? "—" : `${latency} ms`} accent={speaking} />
      </div>
      {!voices.length && <StatusMessage title="Vozes ainda não carregaram" type="info">Aguarde o evento voiceschanged ou verifique as vozes instaladas no sistema.</StatusMessage>}
    </LabFrame>
  );
}

export function SttBrowserLab() {
  const supported = speechRecognitionSupported();
  const recognition = useRef<ReturnType<typeof createRecognition> | null>(null);
  const startedAt = useRef(0);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [final, setFinal] = useState("");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number>();
  const { addResult } = useExperiments();

  const start = () => {
    setError(""); setPartial("");
    startedAt.current = performance.now();
    recognition.current = createRecognition({
      onPartial: (value) => { setPartial(value); if (!latency) setLatency(Math.round(performance.now() - startedAt.current)); },
      onFinal: (value) => {
        setFinal((current) => `${current} ${value}`.trim()); setPartial("");
        const total = Math.round(performance.now() - startedAt.current);
        addResult({ modeId: "stt-browser", modeName: "STT Simples", runtime: "Browser", model: "SpeechRecognition", stt: "SpeechRecognition", tts: "—", status: "success", totalMs: total, acceptsVoice: true, generatesVoice: false, notes: ["Somente transcrição"] });
      },
      onError: (message) => { setError(message); setListening(false); },
      onEnd: () => setListening(false),
    });
    recognition.current.start();
    setListening(true);
  };

  return (
    <LabFrame lab={labById["stt-browser"]}>
      {!supported && <StatusMessage title="SpeechRecognition indisponível">Use Chrome/Edge ou habilite o backend Whisper local na aba de Debug.</StatusMessage>}
      <div className={`mic-stage ${listening ? "is-listening" : ""}`}>
        <div className="mic-orbit"><span /><button onClick={listening ? () => recognition.current?.stop() : start} disabled={!supported} aria-label={listening ? "Parar reconhecimento" : "Iniciar reconhecimento"}>{listening ? <MicOff /> : <Mic />}</button></div>
        <div><strong>{listening ? "Ouvindo…" : "Microfone em espera"}</strong><p>{listening ? "Fale naturalmente; resultados parciais aparecem abaixo." : "O áudio é controlado pela implementação do navegador."}</p></div>
      </div>
      <div className="action-row">
        <Button onClick={start} disabled={!supported || listening}><Play size={16} /> Iniciar reconhecimento</Button>
        <Button variant="secondary" onClick={() => recognition.current?.stop()} disabled={!listening}><Pause size={16} /> Parar</Button>
        <Button variant="secondary" onClick={() => { recognition.current?.abort(); setFinal(""); setPartial(""); }}><Square size={15} /> Limpar</Button>
        <Metric label="Primeira parcial" value={latency === undefined ? "—" : `${latency} ms`} accent={listening} />
      </div>
      {error && <StatusMessage title="Falha no reconhecimento">{error === "not-allowed" ? "Permissão de microfone bloqueada. Libere-a nas configurações do site." : error}</StatusMessage>}
      <div className="results-grid">
        <ResultPanel label="TRANSCRIÇÃO PARCIAL" muted><p>{partial || "Aguardando fala…"}</p></ResultPanel>
        <ResultPanel label="TRANSCRIÇÃO FINAL"><p>{final || "Nenhum trecho finalizado."}</p></ResultPanel>
      </div>
    </LabFrame>
  );
}
