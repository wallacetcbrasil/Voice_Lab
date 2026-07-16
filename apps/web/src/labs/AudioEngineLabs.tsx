import { AudioWaveform, CheckCircle2, Download, Eraser, FileAudio, ShieldCheck, Sparkles, Upload, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [voice, setVoice] = useState("");
  const [piperVoices, setPiperVoices] = useState<Array<{ id: string; name: string; quality: string; language: string; installed: boolean }>>([]);
  const [kokoroVoices, setKokoroVoices] = useState<Array<{ id: string; name: string; language: string; languageLabel: string; gender: "female" | "male" }>>([]);
  const [catalogError, setCatalogError] = useState("");
  const [language, setLanguage] = useState("pt-br");
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [preparingVoice, setPreparingVoice] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [generationMs, setGenerationMs] = useState<number>();
  const [size, setSize] = useState<number>();
  const [browserMs, setBrowserMs] = useState<number>();
  const [quality, setQuality] = useState("Não avaliada");
  const { addResult } = useExperiments();

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  useEffect(() => {
    const controller = new AbortController();
    api<{ data: { voices: typeof kokoroVoices | typeof piperVoices } }>(`/api/tts/${engine}/voices`, { signal: controller.signal })
      .then((response) => {
        if (engine === "kokoro") setKokoroVoices(response.data.voices as typeof kokoroVoices);
        else setPiperVoices(response.data.voices as typeof piperVoices);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setCatalogError(caught instanceof Error ? caught.message : "Não foi possível consultar as vozes do Kokoro.");
      });
    return () => controller.abort();
  }, [engine]);

  useEffect(() => {
    if (engine !== "piper" || piperVoices.length === 0) return;
    const selected = piperVoices.find((candidate) => candidate.id === voice);
    if (!selected) {
      const preferred = piperVoices.find((candidate) => candidate.id === "pt_BR-faber-medium" && candidate.installed)
        || piperVoices.find((candidate) => candidate.installed)
        || piperVoices[0];
      setVoice(preferred.id);
      setModelReady(preferred.installed);
    } else {
      setModelReady(selected.installed);
    }
  }, [engine, piperVoices, voice]);

  const filteredKokoroVoices = useMemo(() => kokoroVoices.filter((candidate) => candidate.language === language), [kokoroVoices, language]);
  useEffect(() => {
    if (engine !== "kokoro" || filteredKokoroVoices.length === 0) return;
    if (!filteredKokoroVoices.some((candidate) => candidate.id === voice)) setVoice(filteredKokoroVoices[0].id);
  }, [engine, language, filteredKokoroVoices, voice]);

  const preparePiperVoice = async () => {
    if (!voice) return;
    setPreparingVoice(true); setError("");
    try {
      await api("/api/tts/piper/voices/load", { method: "POST", body: JSON.stringify({ voice }) });
      const response = await api<{ data: { voices: typeof piperVoices } }>("/api/tts/piper/voices");
      setPiperVoices(response.data.voices);
      setModelReady(response.data.voices.some((candidate) => candidate.id === voice && candidate.installed));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.hint ? `${caught.message} — ${caught.hint}` : caught instanceof Error ? caught.message : "Não foi possível preparar a voz.");
    } finally { setPreparingVoice(false); }
  };

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
          <Field label="Voz Piper" hint="Catálogo oficial pt_BR; cada voz é baixada somente quando você a prepara.">
            <Select value={voice} onChange={(event) => setVoice(event.target.value)} disabled={piperVoices.length === 0}>
              {piperVoices.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.quality} · {candidate.installed ? "instalada" : "não instalada"}</option>)}
            </Select>
          </Field>
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
      {engine === "piper" && voice && (
        <div className={`model-load-control ${modelReady ? "loaded" : "pending"}`}>
          <div>{modelReady ? <CheckCircle2 size={18} /> : <Download size={18} />}<div><strong>{modelReady ? "Voz Piper pronta no disco" : "Esta voz ainda não foi baixada"}</strong><p>{modelReady ? "A síntese abre o binário somente durante este teste; nenhum modelo fica na memória." : "O download usa o catálogo oficial e não inicia outro motor."}</p></div></div>
          {!modelReady && <Button onClick={preparePiperVoice} busy={preparingVoice}><Download size={15} /> Preparar voz</Button>}
        </div>
      )}
      <LongOperationNotice active={preparingVoice} title="Baixando a voz Piper selecionada" detail="O arquivo ONNX e sua configuração são salvos no diretório local do Voice Lab." />
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
type RvcModel = { id: string; name: string; size: number };

function VoiceTransformLab({ mode }: { mode: VoiceMode }) {
  const lab = labById[mode];
  const [file, setFile] = useState<File>();
  const [duration, setDuration] = useState<number>();
  const [text, setText] = useState("Este teste utiliza uma voz com autorização explícita.");
  const [language, setLanguage] = useState(mode === "openvoice" ? "en" : "pt");
  const [rhythm, setRhythm] = useState(1);
  const [transpose, setTranspose] = useState(0);
  const [f0Method, setF0Method] = useState("rmvpe");
  const [consent, setConsent] = useState(false);
  const [trustedCheckpoint, setTrustedCheckpoint] = useState(false);
  const [rvcModels, setRvcModels] = useState<RvcModel[]>([]);
  const [selectedRvcModel, setSelectedRvcModel] = useState("");
  const [rvcCheckpoint, setRvcCheckpoint] = useState<File>();
  const [importingRvc, setImportingRvc] = useState(false);
  const [xttsLicenseAccepted, setXttsLicenseAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [elapsed, setElapsed] = useState<number>();
  const { addResult } = useExperiments();

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => { setDuration(audio.duration); URL.revokeObjectURL(url); };
    audio.onerror = () => { setDuration(undefined); setError("Não foi possível ler a duração do áudio selecionado."); URL.revokeObjectURL(url); };
  }, [file]);

  const refreshRvcModels = useCallback(async () => {
    const response = await api<{ data: { models: RvcModel[] } }>("/api/voice-conversion/rvc/models");
    setRvcModels(response.data.models);
    setSelectedRvcModel((current) => response.data.models.some((candidate) => candidate.id === current) ? current : response.data.models[0]?.id || "");
  }, []);

  useEffect(() => {
    if (mode !== "rvc") return;
    refreshRvcModels().catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível consultar os modelos RVC."));
  }, [mode, refreshRvcModels]);

  useEffect(() => {
    if (mode === "rvc") setModelReady(Boolean(selectedRvcModel));
  }, [mode, selectedRvcModel]);

  const durationValid = mode !== "xtts" || (duration !== undefined && duration >= 6 && duration <= 15.25);

  const importRvcCheckpoint = async () => {
    if (!rvcCheckpoint || !consent || !trustedCheckpoint) return;
    setImportingRvc(true); setError("");
    const form = new FormData();
    form.append("model", rvcCheckpoint);
    form.append("consentConfirmed", String(consent));
    form.append("trustedCheckpointConfirmed", String(trustedCheckpoint));
    try {
      const imported = await api<{ data: RvcModel }>("/api/voice-conversion/rvc/models", { method: "POST", body: form });
      await refreshRvcModels();
      setSelectedRvcModel(imported.data.id);
      setRvcCheckpoint(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.hint ? `${caught.message} — ${caught.hint}` : caught instanceof Error ? caught.message : "Falha ao importar checkpoint RVC.");
    } finally { setImportingRvc(false); }
  };

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
    form.append("rhythm", String(rhythm));
    if (mode === "rvc") {
      form.append("model", selectedRvcModel);
      form.append("transpose", String(transpose));
      form.append("f0Method", f0Method);
    }
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
      <Toggle checked={consent} onChange={setConsent} label="Confirmo que a voz é minha ou tenho autorização explícita para usá-la." />
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
      {mode === "rvc" && (
        <div className="rvc-model-library">
          <div>
            <strong>Biblioteca local de checkpoints autorizados</strong>
            <p>O Voice Lab não distribui timbres de terceiros. Importe seu próprio arquivo .pth; checkpoints PyTorch podem executar código e devem vir de uma fonte confiável.</p>
          </div>
          <div className="form-grid">
            <Field label="Checkpoint RVC disponível">
              <Select value={selectedRvcModel} onChange={(event) => setSelectedRvcModel(event.target.value)} disabled={rvcModels.length === 0}>
                {rvcModels.length === 0 && <option value="">Nenhum checkpoint importado</option>}
                {rvcModels.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {Math.ceil(candidate.size / 1024 / 1024)} MB</option>)}
              </Select>
            </Field>
            <Field label="Importar checkpoint próprio/autorizado" hint="Arquivo .pth local; não é enviado a serviços externos.">
              <Input type="file" accept=".pth,application/octet-stream" onChange={(event) => setRvcCheckpoint(event.target.files?.[0])} />
            </Field>
          </div>
          <Toggle checked={trustedCheckpoint} onChange={setTrustedCheckpoint} label="Confirmo que este checkpoint é próprio/autorizado e vem de uma origem em que confio." />
          <Button variant="secondary" onClick={importRvcCheckpoint} busy={importingRvc} disabled={!rvcCheckpoint || !consent || !trustedCheckpoint}><Upload size={15} /> Importar para a biblioteca local</Button>
        </div>
      )}
      <AudioInputGuide kind={mode === "rvc" ? "input" : "reference"} onRecorded={setFile} minDuration={mode === "xtts" ? 6 : 0} maxDuration={mode === "xtts" ? 15 : 60} />
      <div className="voice-upload">
        <FileAudio size={32} />
        <div><strong>{file?.name || (mode === "rvc" ? "Áudio de entrada" : "Referência de voz")}</strong><p>{file ? `${Math.ceil(file.size / 1024)} KB · ${duration ? `${duration.toFixed(1)} s` : "lendo duração"} · ruído não analisado` : "WAV, MP3, M4A ou WebM com fala clara"}</p></div>
        <Input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} />
      </div>
      {mode === "xtts" && duration !== undefined && !durationValid && <StatusMessage title="Duração incompatível">A referência XTTS-v2 deve ter entre 6 e 15 segundos. A amostra atual tem {duration.toFixed(1)} s.</StatusMessage>}
      {mode !== "rvc" && <Field label="Texto de saída"><Textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} /></Field>}
      {mode !== "rvc" && <Field label="Idioma"><Select value={language} onChange={(event) => setLanguage(event.target.value)}>
        {mode === "openvoice" ? <><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="zh">中文</option><option value="ja">日本語</option><option value="ko">한국어</option></> : <><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pl">Polski</option><option value="tr">Türkçe</option><option value="ru">Русский</option><option value="nl">Nederlands</option><option value="cs">Čeština</option><option value="ar">العربية</option><option value="zh-cn">中文</option><option value="hu">Magyar</option><option value="ko">한국어</option><option value="ja">日本語</option><option value="hi">हिन्दी</option></>}
      </Select></Field>}
      {mode === "openvoice" && <><Range label="Ritmo" value={rhythm} min={0.7} max={1.4} step={0.1} onChange={setRhythm} /><p className="footnote">Este adapter aplica somente o ritmo do MeloTTS e o timbre extraído da referência. Emoção e sotaque não são exibidos porque este caminho não os implementa.</p></>}
      {mode === "rvc" && <div className="form-grid"><Range label="Transposição (semitons)" value={transpose} min={-12} max={12} step={1} onChange={setTranspose} /><Field label="Extração de pitch"><Select value={f0Method} onChange={(event) => setF0Method(event.target.value)}><option value="rmvpe">RMVPE · recomendado</option><option value="harvest">Harvest</option><option value="dio">DIO</option><option value="pm">Parselmouth</option></Select></Field></div>}
      <div className="action-row">
        <Button onClick={run} busy={busy} disabled={!file || !consent || !modelReady || !durationValid}><Sparkles size={16} /> {mode === "rvc" ? "Converter voz" : mode === "xtts" ? "Gerar voz clonada" : "Gerar timbre/estilo"}</Button>
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
