import { Activity, Database, Eraser, Gauge, RefreshCw, Server, Shield, Trash2, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { Button, Metric, ResultPanel, StatusMessage } from "../components/Controls";
import { labById, labs } from "./catalog";
import { api } from "../services/apiClient";
import { useExperiments } from "../state/ExperimentStore";

const modeProfiles: Record<string, { internet: string; cost: string; privacy: string; best: string }> = {
  "tts-browser": { internet: "Talvez", cost: "Zero", privacy: "Média", best: "Protótipo rápido" },
  "stt-browser": { internet: "Talvez", cost: "Zero", privacy: "Média", best: "Ditado" },
  "lm-chat": { internet: "Não", cost: "Zero", privacy: "Alta", best: "Chat local" },
  "turn-voice": { internet: "Talvez*", cost: "Zero", privacy: "Média/alta", best: "Assistente por turnos" },
  "qwen-lm": { internet: "Não", cost: "Zero", privacy: "Alta", best: "Estudo de runtime" },
  "qwen-llama": { internet: "Não", cost: "Zero", privacy: "Alta", best: "Controle e benchmark" },
  "qwen-python": { internet: "Não", cost: "Energia/GPU", privacy: "Alta", best: "Áudio multimodal nativo" },
  rag: { internet: "Não", cost: "Zero", privacy: "Alta", best: "Conhecimento privado" },
  piper: { internet: "Não", cost: "Zero", privacy: "Alta", best: "TTS leve offline" },
  kokoro: { internet: "Não", cost: "Zero", privacy: "Alta", best: "TTS natural local" },
  xtts: { internet: "Não", cost: "Energia/GPU", privacy: "Alta", best: "Voz autorizada" },
  openvoice: { internet: "Não", cost: "Energia/GPU", privacy: "Alta", best: "Timbre e estilo" },
  rvc: { internet: "Não", cost: "Energia/GPU", privacy: "Alta", best: "Conversão de voz" },
  realtime: { internet: "Talvez*", cost: "Zero", privacy: "Depende do navegador", best: "Estudo de transporte e turnos curtos" },
};

const rankings = [
  ["Melhor para protótipo rápido", "TTS/STT do navegador", "zero instalação extra"],
  ["Melhor custo zero", "Piper + whisper.cpp", "offline e sem tarifa por uso"],
  ["Melhor qualidade de voz", "Kokoro / XTTS", "depende de idioma, voz e GPU"],
  ["Melhor privacidade", "Pipeline totalmente local", "áudio não deixa a máquina"],
  ["Mais parecido com chamada natural", "Audio-to-audio streaming", "exige VAD, barge-in e saída incremental"],
  ["Mais fácil de manter", "STT → LLM → TTS", "componentes substituíveis e observáveis"],
  ["Mais adequado para rodar localmente", "Piper + llama.cpp", "binários previsíveis e quantização"],
  ["Melhor para estudar arquitetura", "Voice Lab completo", "compara os limites lado a lado"],
];

export function ComparisonLab() {
  const { results, clearResults } = useExperiments();
  const rows = useMemo(() => labs.filter((lab) => modeProfiles[lab.id]).map((lab) => {
    const attempts = results.filter((result) => result.modeId === lab.id);
    const successful = attempts.filter((result) => typeof result.totalMs === "number" && result.status !== "error");
    const average = successful.length ? Math.round(successful.reduce((sum, result) => sum + (result.totalMs || 0), 0) / successful.length) : undefined;
    const latest = attempts[0];
    const profile = modeProfiles[lab.id];
    return {
      lab, latest, attempts: attempts.length, average, profile,
      runtime: latest?.runtime || "Não testado", model: latest?.model || "—", stt: latest?.stt || (lab.id.includes("stt") ? "Browser" : "—"),
      tts: latest?.tts || (["piper", "kokoro", "xtts", "openvoice"].includes(lab.id) ? lab.shortTitle : "—"),
      voiceIn: latest?.acceptsVoice ?? ["stt-browser", "turn-voice", "rag", "rvc", "realtime"].includes(lab.id),
      voiceOut: latest?.generatesVoice ?? ["tts-browser", "turn-voice", "piper", "kokoro", "xtts", "openvoice", "rvc"].includes(lab.id),
    };
  }), [results]);

  return (
    <LabFrame lab={labById.comparison}>
      <div className="summary-band">
        <div><Trophy /><span>Experimentos registrados</span><strong>{results.length}</strong></div>
        <div><Gauge /><span>Modos já testados</span><strong>{new Set(results.map((result) => result.modeId)).size}/{rows.length}</strong></div>
        <Button variant="secondary" onClick={clearResults}><Trash2 size={15} /> Limpar medições</Button>
      </div>
      <div className="table-wrap comparison-table">
        <table>
          <thead><tr>{["Modo", "Modelo", "Runtime", "STT", "TTS", "Voz in?", "Voz out?", "Internet?", "Custo", "Latência média", "Naturalidade", "Privacidade", "Melhor uso", "Observações"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{rows.map(({ lab, latest, attempts, average, profile, runtime, model, stt, tts, voiceIn, voiceOut }) => <tr key={lab.id}>
            <td><span className="table-mode">{lab.shortTitle}</span><small>{attempts} teste(s)</small></td><td>{model}</td><td>{runtime}</td><td>{stt}</td><td>{tts}</td>
            <td>{voiceIn ? "Sim" : "Não"}</td><td>{voiceOut ? "Sim" : "Não"}</td><td>{profile.internet}</td><td>{profile.cost}</td>
            <td>{average ? `${average} ms` : "Não medida"}</td><td>{lab.naturalness}</td><td>{profile.privacy}</td><td>{profile.best}</td>
            <td>{latest?.notes.join(" · ") || "Execute o laboratório"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="ranking-grid">{rankings.map(([title, winner, reason], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{title}</small><strong>{winner}</strong><p>{reason}</p></div></article>)}</div>
      <p className="footnote">Rankings são recomendações arquiteturais iniciais. Latência média usa apenas medições observadas nesta máquina.</p>
    </LabFrame>
  );
}

interface HealthData {
  backend: string;
  uptimeSeconds: number;
  lmStudio: { status: string; baseUrl: string; models: number };
  services: Array<{ id: string; label: string; status: string; detail: string; installHint: string }>;
  rag: { documents: number; chunks: number };
  realtime: { sessions: number; connected: number };
  memory: { rssMb: number; heapUsedMb: number };
}

interface LogData {
  id: string; timestamp: string; level: string; category: string; message: string; durationMs?: number; requestId?: string; payloadSummary?: string;
}

export function DebugLab() {
  const [health, setHealth] = useState<HealthData>();
  const [logs, setLogs] = useState<LogData[]>([]);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);

  const refresh = async () => {
    try {
      const [healthPayload, logsPayload] = await Promise.all([api<any>("/api/health"), api<any>("/api/logs")]);
      setHealth(healthPayload); setLogs(logsPayload.data); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Backend offline"); }
  };

  useEffect(() => { void refresh(); if (!auto) return; const id = window.setInterval(refresh, 4000); return () => clearInterval(id); }, [auto]);

  const clear = async () => { await api("/api/logs", { method: "DELETE" }); setLogs([]); };

  return (
    <LabFrame lab={labById.debug}>
      <div className="action-row">
        <Button onClick={refresh}><RefreshCw size={16} /> Atualizar diagnóstico</Button>
        <Button variant="secondary" onClick={() => setAuto((value) => !value)}><Activity size={16} /> Auto: {auto ? "ligado" : "desligado"}</Button>
        <Button variant="secondary" onClick={clear}><Eraser size={15} /> Limpar logs</Button>
      </div>
      {error && <StatusMessage title="Backend offline">{error}. Execute npm run dev:server e confira a porta 3333.</StatusMessage>}
      <div className="health-grid">
        <HealthCard icon={<Server />} label="Backend" value={health?.backend || "offline"} detail={health ? `uptime ${health.uptimeSeconds}s` : "sem resposta"} />
        <HealthCard icon={<Database />} label="LM Studio" value={health?.lmStudio.status || "desconhecido"} detail={health ? `${health.lmStudio.models} modelo(s) · ${health.lmStudio.baseUrl}` : "não sondado"} />
        <HealthCard icon={<Gauge />} label="Memória Node" value={health ? `${health.memory.rssMb} MB` : "—"} detail={health ? `heap ${health.memory.heapUsedMb} MB` : "não medida"} />
        <HealthCard icon={<Shield />} label="Dados locais" value="protegidos" detail="payloads e áudio são sanitizados nos logs" />
      </div>
      <section className="services-panel">
        <div className="section-label">SERVIÇOS LOCAIS DE ÁUDIO E MODELOS</div>
        <div className="service-list">{health?.services.map((service) => <article key={service.id}><span className={`service-dot status-${service.status}`} /><div><strong>{service.label}</strong><p>{service.detail}</p><small>{service.installHint}</small></div><code>{service.status}</code></article>) || <p>Carregando serviços…</p>}</div>
      </section>
      <div className="metric-row">
        <Metric label="Documentos RAG" value={health?.rag.documents ?? "—"} />
        <Metric label="Chunks RAG" value={health?.rag.chunks ?? "—"} />
        <Metric label="Sessões realtime" value={health?.realtime.sessions ?? "—"} />
        <Metric label="Logs em memória" value={logs.length} />
      </div>
      <ResultPanel label="REQUISIÇÕES, CORS, TIMEOUTS E ERROS">
        <div className="log-table">
          {logs.length ? logs.map((log) => <article key={log.id} className={`log-${log.level}`}><time>{new Date(log.timestamp).toLocaleTimeString()}</time><span>{log.category}</span><strong>{log.message}</strong><code>{log.durationMs !== undefined ? `${log.durationMs} ms` : log.requestId?.slice(0, 8)}</code>{log.payloadSummary && <small>{log.payloadSummary}</small>}</article>) : <p>Nenhum log. Faça uma requisição em outro laboratório.</p>}
        </div>
      </ResultPanel>
    </LabFrame>
  );
}

function HealthCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article className="health-card"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}
