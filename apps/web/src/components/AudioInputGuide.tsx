import { CircleStop, FileAudio, Mic, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, StatusMessage } from "./Controls";

export function AudioInputGuide({
  kind,
  onRecorded,
  minDuration = 0,
  maxDuration = 60,
}: {
  kind: "reference" | "input";
  onRecorded: (file: File) => void;
  minDuration?: number;
  maxDuration?: number;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const acceptedDuration = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const automaticStop = useRef<number | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const clearTimers = () => {
    if (timer.current) window.clearInterval(timer.current);
    if (automaticStop.current) window.clearTimeout(automaticStop.current);
    timer.current = undefined;
    automaticStop.current = undefined;
  };

  useEffect(() => () => {
    clearTimers();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const start = async () => {
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      stream.current = media;
      chunks.current = [];
      const nextRecorder = new MediaRecorder(media, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined);
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" });
        if (acceptedDuration.current >= minDuration && blob.size > 0) {
          onRecorded(new File([blob], `voice-lab-${kind}-${Date.now()}.webm`, { type: blob.type }));
        }
        media.getTracks().forEach((track) => track.stop());
        clearTimers();
        setRecording(false);
      };
      nextRecorder.start(250);
      recorder.current = nextRecorder;
      startedAt.current = performance.now();
      acceptedDuration.current = 0;
      setElapsed(0);
      setRecording(true);
      timer.current = window.setInterval(() => setElapsed(Math.min(maxDuration, (performance.now() - startedAt.current) / 1000)), 100);
      automaticStop.current = window.setTimeout(() => {
        acceptedDuration.current = maxDuration;
        setElapsed(maxDuration);
        if (recorder.current?.state === "recording") recorder.current.stop();
      }, maxDuration * 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Microfone indisponível.");
    }
  };

  const stop = () => {
    const duration = (performance.now() - startedAt.current) / 1000;
    if (duration < minDuration) {
      setError(`Continue gravando até pelo menos ${minDuration} segundos.`);
      return;
    }
    acceptedDuration.current = Math.min(duration, maxDuration);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return (
    <div className="audio-guide">
      <div className="audio-guide-copy">
        {kind === "reference" ? <ShieldCheck /> : <FileAudio />}
        <div>
          <strong>{kind === "reference" ? "O que é áudio de referência?" : "Que áudio devo enviar?"}</strong>
          {kind === "reference" ? (
            <p>É uma amostra da voz que o modelo deve imitar: grave 6–15 segundos, uma pessoa, voz natural, pouco eco, sem música. Use somente sua voz ou voz autorizada.</p>
          ) : (
            <p>É a pergunta ou som que o modelo deve ouvir e entender. Não serve para clonar timbre. Grave uma frase curta ou envie WAV, MP3, M4A ou WebM.</p>
          )}
        </div>
      </div>
      <Button variant={recording ? "danger" : "secondary"} onClick={recording ? stop : start}>
        {recording ? <><CircleStop size={15} /> {elapsed < minDuration ? `Gravando · ${elapsed.toFixed(1)} s` : "Parar e usar gravação"}</> : <><Mic size={15} /> Gravar agora pelo microfone</>}
      </Button>
      {recording && maxDuration > 0 && (
        <div className="recording-limit" role="status" aria-live="polite">
          <div><strong>{elapsed.toFixed(1)} s</strong><span>mínimo {minDuration} s · máximo {maxDuration} s</span></div>
          <div className="recording-limit-track"><span style={{ width: `${Math.min(100, (elapsed / maxDuration) * 100)}%` }} /><i style={{ left: `${(minDuration / maxDuration) * 100}%` }} /></div>
          <small>{elapsed < minDuration ? `Faltam ${(minDuration - elapsed).toFixed(1)} s para habilitar a amostra.` : "Amostra válida; a gravação encerra automaticamente no limite."}</small>
        </div>
      )}
      {error && <StatusMessage title="Não foi possível gravar">{error}</StatusMessage>}
    </div>
  );
}
