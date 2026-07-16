import { AudioWaveform, Eraser, FileAudio, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { Button, Field, Input, LongOperationNotice, Metric, Range, ResultPanel, Select, StatusMessage, Textarea, Toggle } from "../components/Controls";
import { labById } from "./catalog";
import { ApiError, api, playBlob } from "../services/apiClient";
import { speak } from "../services/browserTtsClient";
import { useExperiments } from "../state/ExperimentStore";
import { AudioInputGuide } from "../components/AudioInputGuide";
import { ModelLoadControl } from "../components/ModelLoadControl";

function LocalTtsLab({ engine }: { engine: "piper" | "kokoro" }) {
  const lab = labById[engine];
  const [text, setText] = useState("Esta frase foi gerada por um motor de voz local.");
  const [voice, setVoice] = useState(engine === "kokoro" ? "" : "modelo configurado");
  const [kokoroVoices, setKokoroVoices] = useState<Array<{ id: string; name: string; language: string; languageLabel: string; gender: "female" | "male" }>>([]);
  const [catalogError, setCatalogError] = useState("");
  const [language, setLanguage] = useState("pt-br");
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [modelReady, setModelReady] = useState(engine === "piper");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [generationMs, setGenerationMs] = useState<number>();
  const [size, setSize] = useState<number>();
  const [browserMs, setBrowserMs] = useState<number>();
  const [quality, setQuality] = useState("Não avaliada");
  const { addResult } = useExperiments();

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  useEffect(() => {
    if (engine !== "kokoro") return;
    const controller = new AbortController();
    api<{ data: { voices: typeof kokoroVoices } }>("/api/tts/kokoro/voices", { signal: controller.signal })
      .then((response) => setKokoroVoices(response.data.voices))
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setCatalogError(caught instanceof Error ? caught.message : "Não foi possível consultar as vozes do Kokoro.");
      });
    return () => controller.abort();
  }, [engine]);

  const filteredKokoroVoices = useMemo(() => kokoroVoices.filter((candidate) => candidate.language === language), [kokoroVoices, language]);
  useEffect(() => {
    if (engine !== "kokoro" || filteredKokoroVoices.length === 0) return;
    if (!filteredKokoroVoices.some((candidate) => candidate.id === voice)) setVoice(filteredKokoroVoices[0].id);
  }, [engine, language, filteredKokoroVoices, voice]);

  const generate = async () => {
    setBusy(true); setError("");
    const started = performance.now();
    try {
      const blob = await api<Blob>(`/api/tts/${engine}`, {
        method: "POST", body: JSON.stringify({ text, voice, language, speed }),
      });
      const elapsed = Math.round(performance.now() - started);
      setGenerationMs(elapsed); setSize(blob.size);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob); setAudioUrl(url);
      await new Audio(url).play();
      addResult({
        modeId: engine, modeName: lab.title, runtime: engine === "piper" ? "Piper CLI" : "Python bridge",
        model: voice, stt: "—", tts: engine, status: "success", totalMs: elapsed,
        acceptsVoice: false, generatesVoice: true, notes: [`${Math.ceil(blob.size / 1024)} KB`, `Qualidade: ${quality}`],
      });
    } catch (error) {
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha");
    } finally { setBusy(false); }
  };

  const browserCompare = () => {
    const started = performance.now();
    speak(text, { onStart: () => setBrowserMs(Math.round(performance.now() - started)) });
  };

  return (
    <LabFrame lab={lab}>
      <Field label="Texto"><Textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} /></Field>
      <div className="form-grid">
        {engine === "piper" ? (
          <Field label="Voz/modelo configurado"><Input value={voice} readOnly /></Field>
        ) : (
          <Field label="Voz Kokoro" hint={`${filteredKokoroVoices.length} voz(es) disponíveis para o idioma selecionado`}>
            <Select value={voice} onChange={(event) => setVoice(event.target.value)} disabled={filteredKokoroVoices.length === 0}>
              {filteredKokoroVoices.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.gender === "female" ? "feminina" : "masculina"} · {candidate.id}</option>)}
            </Select>
          </Field>
        )}
        {engine === "kokoro" ? (
          <Field label="Idioma"><Select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="pt-br">Português do Brasil</option><option value="en-us">English (US)</option><option value="en-gb">English (UK)</option><option value="es">Español</option><option value="fr-fr">Français</option><option value="hi">हिन्दी</option><option value="it">Italiano</option><option value="ja">日本語</option><option value="zh">中文</option></Select></Field>
        ) : <Range label="Velocidade" value={speed} min={0.6} max={1.6} step={0.1} onChange={setSpeed} />}
      </div>
      {catalogError && <StatusMessage title="Catálogo de vozes indisponível">{catalogError}</StatusMessage>}
      {engine === "kokoro" && <ModelLoadControl engine="kokoro" label="Kokoro-82M" options={{ language }} onReady={setModelReady} />}
      <div className="action-row">
        <Button onClick={generate} busy={busy} disabled={!modelReady || (engine === "kokoro" && !voice)}><AudioWaveform size={16} /> Gerar com {engine === "piper" ? "Piper" : "Kokoro"}</Button>
        <Button variant="secondary" onClick={browserCompare}><Volume2 size={16} /> Comparar navegador</Button>
      </div>
      <LongOperationNotice active={busy} title={engine === "piper" ? "Sintetizando com Piper" : "Gerando fala com Kokoro"} detail="O tempo exibido é medido no navegador até o backend devolver o áudio completo." />
      {error && <StatusMessage title={`${engine === "piper" ? "Piper" : "Kokoro"} não disponível`}>{error}</StatusMessage>}
      <div className="metric-row">
        <Metric label="Geração local" value={generationMs ? `${generationMs} ms` : "—"} />
        <Metric label="Tamanho do áudio" value={size ? `${Math.ceil(size / 1024)} KB` : "—"} />
        <Metric label="Início navegador" value={browserMs ? `${browserMs} ms` : "—"} />
        <Metric label="Qualidade percebida" value={quality} />
      </div>
      {audioUrl && <ResultPanel label="ÁUDIO GERADO"><audio controls src={audioUrl} /><Field label="Sua avaliação"><Select value={quality} onChange={(event) => setQuality(event.target.value)}><option>Não avaliada</option><option>Baixa</option><option>Média</option><option>Alta</option><option>Excelente</option></Select></Field></ResultPanel>}
    </LabFrame>
  );
}

export const PiperLab = () => <LocalTtsLab engine="piper" />;
export const KokoroLab = () => <LocalTtsLab engine="kokoro" />;

type VoiceMode = "xtts" | "openvoice" | "rvc";

function VoiceTransformLab({ mode }: { mode: VoiceMode }) {
  const lab = labById[mode];
  const [file, setFile] = useState<File>();
  const [duration, setDuration] = useState<number>();
  const [text, setText] = useState("Este teste utiliza uma voz com autorização explícita.");
  const [language, setLanguage] = useState(mode === "openvoice" ? "en" : "pt");
  const [rhythm, setRhythm] = useState(1);
  const [consent, setConsent] = useState(false);
  const [xttsLicenseAccepted, setXttsLicenseAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modelReady, setModelReady] = useState(mode === "rvc");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [elapsed, setElapsed] = useState<number>();
  const { addResult } = useExperiments();

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => { setDuration(audio.duration); URL.revokeObjectURL(url); };
  }, [file]);

  const run = async () => {
    if (!file || !consent) return;
    setBusy(true); setError("");
    const started = performance.now();
    const endpoint = mode === "xtts" ? "/api/voice-clone/xtts" : mode === "openvoice" ? "/api/voice-clone/openvoice" : "/api/voice-conversion/rvc";
    const form = new FormData();
    form.append("audio", file);
    form.append("consentConfirmed", String(consent));
    form.append("language", language);
    if (mode !== "rvc") form.append("text", text);
    form.append("emotion", "neutro");
    form.append("rhythm", String(rhythm));
    form.append("accent", "padrão");
    try {
      const blob = await api<Blob>(endpoint, { method: "POST", body: form });
      const measured = Math.round(performance.now() - started); setElapsed(measured);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob); setAudioUrl(url); playBlob(blob);
      addResult({
        modeId: mode, modeName: lab.title, runtime: "Python bridge", model: mode,
        stt: "—", tts: mode === "rvc" ? "—" : mode, status: "success", totalMs: measured,
        acceptsVoice: true, generatesVoice: true, notes: ["Consentimento confirmado", mode === "rvc" ? "Voice conversion" : "TTS com referência"],
      });
    } catch (error) {
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha");
    } finally { setBusy(false); }
  };

  const deleteSamples = async () => {
    try {
      await api("/api/voice-samples?consentConfirmed=true", { method: "DELETE" });
      setFile(undefined); setAudioUrl(""); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível apagar."); }
  };

  return (
    <LabFrame lab={lab}>
      <div className="consent-banner"><ShieldCheck size={24} /><div><strong>Use apenas sua própria voz ou voz com autorização explícita.</strong><p>Não há presets de pessoas públicas. A amostra não deve ser enviada a serviços externos.</p></div></div>
      {mode === "xtts" && (
        <div className="license-confirmation">
          <Toggle checked={xttsLicenseAccepted} onChange={setXttsLicenseAccepted} label="Li e aceito a licença CPML aplicável ao checkpoint XTTS-v2." />
          <a href="https://tts-hub.github.io/cpml/" target="_blank" rel="noreferrer">Ler a CPML oficial</a>
        </div>
      )}
      {mode !== "rvc" && (
        <ModelLoadControl
          engine={mode}
          label={mode === "xtts" ? "XTTS-v2" : "OpenVoice V2 + MeloTTS"}
          options={mode === "openvoice" ? { language } : { acceptCoquiLicense: xttsLicenseAccepted }}
          disabled={mode === "xtts" && !xttsLicenseAccepted}
          disabledReason={mode === "xtts" && !xttsLicenseAccepted ? "O checkpoint XTTS-v2 usa a Coqui Public Model License. Leia e aceite os termos antes que o bridge faça o download." : undefined}
          onReady={setModelReady}
        />
      )}
      <AudioInputGuide kind={mode === "rvc" ? "input" : "reference"} onRecorded={setFile} />
      <div className="voice-upload">
        <FileAudio size={32} />
        <div><strong>{file?.name || (mode === "rvc" ? "Áudio de entrada" : "Referência de voz")}</strong><p>{file ? `${Math.ceil(file.size / 1024)} KB · ${duration ? `${duration.toFixed(1)} s` : "lendo duração"} · ruído não analisado` : "WAV, MP3, M4A ou WebM com fala clara"}</p></div>
        <Input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} />
      </div>
      {mode !== "rvc" && <Field label="Texto de saída"><Textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} /></Field>}
      <div className="form-grid">
        <Field label="Idioma"><Select value={language} onChange={(event) => setLanguage(event.target.value)}>
          {mode === "openvoice" ? <><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="zh">中文</option><option value="ja">日本語</option><option value="ko">한국어</option></> : <><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option></>}
        </Select></Field>
        <Field label={mode === "rvc" ? "Modelo RVC" : mode === "openvoice" ? "Estilo disponível" : "Voz/modelo"}><Input value={mode === "openvoice" ? "Timbre da referência + ritmo" : "configurado no backend"} readOnly /></Field>
      </div>
      {mode === "openvoice" && <><Range label="Ritmo" value={rhythm} min={0.7} max={1.4} step={0.1} onChange={setRhythm} /><p className="footnote">Este adapter aplica somente o ritmo do MeloTTS e o timbre extraído da referência. Emoção e sotaque não são exibidos porque este caminho não os implementa.</p></>}
      <Toggle checked={consent} onChange={setConsent} label="Confirmo que a voz é minha ou tenho autorização explícita para usá-la." />
      <div className="action-row">
        <Button onClick={run} busy={busy} disabled={!file || !consent || !modelReady}><Sparkles size={16} /> {mode === "rvc" ? "Converter voz" : mode === "xtts" ? "Gerar voz clonada" : "Gerar timbre/estilo"}</Button>
        <Button variant="secondary" onClick={deleteSamples}><Eraser size={15} /> Apagar amostras</Button>
        <Metric label="Geração" value={elapsed ? `${elapsed} ms` : "—"} />
      </div>
      <LongOperationNotice active={busy} title={mode === "rvc" ? "Convertendo com RVC" : "Gerando áudio com o modelo carregado"} detail={mode === "rvc" ? "O RVC carrega o checkpoint dentro do processo de conversão; o tempo real continua visível e usa um limite dedicado de 15 minutos." : "O checkpoint já foi preparado; esta etapa mede somente processamento e geração do áudio."} />
      {error && <StatusMessage title="Módulo local indisponível">{error}</StatusMessage>}
      <ResultPanel label="CHECKLIST / RESULTADO" muted>
        <div className="checklist-inline">
          <span className={file ? "done" : ""}>Referência carregada</span><span className={consent ? "done" : ""}>Autorização</span>
          <span className={duration ? "done" : ""}>Duração</span><span>Idioma: {language}</span><span>Ruído: não analisado</span>
        </div>
        {audioUrl ? <audio controls src={audioUrl} /> : <p>Nenhum arquivo gerado.</p>}
      </ResultPanel>
    </LabFrame>
  );
}

export const XttsLab = () => <VoiceTransformLab mode="xtts" />;
export const OpenVoiceLab = () => <VoiceTransformLab mode="openvoice" />;
export const RvcLab = () => <VoiceTransformLab mode="rvc" />;
