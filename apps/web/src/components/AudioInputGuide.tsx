import { CircleStop, FileAudio, Mic, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button, StatusMessage } from "./Controls";

export function AudioInputGuide({
  kind,
  onRecorded,
}: {
  kind: "reference" | "input";
  onRecorded: (file: File) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

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
        onRecorded(new File([blob], `voice-lab-${kind}-${Date.now()}.webm`, { type: blob.type }));
        media.getTracks().forEach((track) => track.stop());
      };
      nextRecorder.start();
      recorder.current = nextRecorder;
      setRecording(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Microfone indisponível.");
    }
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
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
        {recording ? <><CircleStop size={15} /> Parar e usar gravação</> : <><Mic size={15} /> Gravar agora pelo microfone</>}
      </Button>
      {error && <StatusMessage title="Não foi possível gravar">{error}</StatusMessage>}
    </div>
  );
}
