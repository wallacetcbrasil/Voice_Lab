import { BookOpen, FilePlus2, Mic, Search, Trash2, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { LabFrame } from "../components/LabFrame";
import { Button, Field, Input, Metric, ResultPanel, StatusMessage, Textarea, Toggle } from "../components/Controls";
import { LmStudioModelPicker } from "../components/LmStudioModelPicker";
import { labById } from "./catalog";
import { ApiError, api, postJson } from "../services/apiClient";
import { speak } from "../services/browserTtsClient";
import { createRecognition, speechRecognitionSupported } from "../services/speechRecognitionClient";
import { useExperiments } from "../state/ExperimentStore";

interface RagQuery {
  provider: string;
  chunks: Array<{ id: string; source: string; content: string; score: number; index: number }>;
  sources: string[];
  prompt: string;
  searchMs: number;
  documentCount: number;
}

function textFromChat(payload: any) {
  return payload?.data?.choices?.[0]?.message?.content || "";
}

export function RagLab() {
  const [manualName, setManualName] = useState("anotacoes.md");
  const [manualText, setManualText] = useState("Voice Lab: TTS transforma texto em voz. STT transforma voz em texto. Um pipeline por turnos não é uma chamada realtime.");
  const [file, setFile] = useState<File>();
  const [sources, setSources] = useState<Array<{ id: string; name: string; chunks: number }>>([]);
  const [question, setQuestion] = useState("Por que um pipeline por turnos não é uma chamada realtime?");
  const [retrieval, setRetrieval] = useState<RagQuery>();
  const [answer, setAnswer] = useState("");
  const [useModel, setUseModel] = useState(true);
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [model, setModel] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [generationMs, setGenerationMs] = useState<number>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recognition = useRef<ReturnType<typeof createRecognition> | null>(null);
  const { addResult } = useExperiments();

  const addSource = async () => {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else { form.append("name", manualName); form.append("text", manualText); }
      const payload = await api<any>("/api/rag/upload", { method: "POST", body: form });
      setSources((current) => [...current, { id: payload.data.id, name: payload.data.name, chunks: payload.data.chunks.length }]);
      setFile(undefined);
    } catch (error) {
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha");
    } finally { setBusy(false); }
  };

  const query = async (override?: string) => {
    const asked = override || question;
    setBusy(true); setError(""); setAnswer("");
    const totalStart = performance.now();
    try {
      const payload = await postJson<{ data: RagQuery }>("/api/rag/query", { query: asked, limit: 4 });
      setRetrieval(payload.data);
      let generated = "Busca concluída. Ative o LM Studio para gerar uma resposta com esses trechos.";
      let generation = 0;
      if (useModel) {
        const genStart = performance.now();
        const chat = await postJson<any>("/api/lmstudio/chat", {
          baseUrl,
          model,
          messages: [{ role: "system", content: "Responda apenas com base no contexto fornecido." }, { role: "user", content: payload.data.prompt }],
        });
        generation = Math.round(performance.now() - genStart);
        generated = textFromChat(chat);
      }
      setAnswer(generated); setGenerationMs(generation);
      const total = Math.round(performance.now() - totalStart);
      addResult({
        modeId: "rag", modeName: "RAG + Chat de Voz", runtime: useModel ? "RAG lexical + LM Studio" : "RAG lexical",
        model: useModel ? "modelo configurado" : "—", stt: "opcional", tts: "speechSynthesis", status: "success",
        totalMs: total, searchMs: payload.data.searchMs, acceptsVoice: true, generatesVoice: Boolean(generated),
        notes: [`${payload.data.chunks.length} chunks recuperados`, `${payload.data.sources.length} fontes`],
      });
    } catch (error) {
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha");
    } finally { setBusy(false); }
  };

  const askByVoice = () => {
    if (!speechRecognitionSupported()) return setError("SpeechRecognition indisponível; digite a pergunta ou habilite Whisper.");
    recognition.current = createRecognition({
      continuous: false,
      onPartial: setQuestion,
      onFinal: (text) => { setQuestion(text); void query(text); },
      onError: setError,
    });
    recognition.current.start();
  };

  const clear = async () => {
    await api("/api/rag", { method: "DELETE" }); setSources([]); setRetrieval(undefined); setAnswer("");
  };

  return (
    <LabFrame lab={labById.rag}>
      <div className="source-builder">
        <div>
          <span className="section-label">FONTE MANUAL</span>
          <Field label="Nome"><Input value={manualName} onChange={(event) => setManualName(event.target.value)} /></Field>
          <Field label="Conteúdo"><Textarea rows={5} value={manualText} onChange={(event) => setManualText(event.target.value)} /></Field>
        </div>
        <div className="file-drop">
          <FilePlus2 size={28} />
          <strong>TXT, MD ou PDF simples</strong>
          <p>PDF precisa de camada de texto; OCR não está incluído no fallback.</p>
          <Input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => setFile(event.target.files?.[0])} />
          {file && <span className="file-pill">{file.name} · {Math.ceil(file.size / 1024)} KB</span>}
        </div>
      </div>
      <div className="action-row">
        <Button onClick={addSource} busy={busy} disabled={!file && !manualText.trim()}><BookOpen size={16} /> Indexar fonte</Button>
        <Button variant="secondary" onClick={clear}><Trash2 size={15} /> Limpar índice</Button>
        <span className="count-label">{sources.length} fonte(s) nesta sessão</span>
      </div>
      {sources.length > 0 && <div className="source-list">{sources.map((source) => <span key={source.id}>{source.name}<small>{source.chunks} chunks</small></span>)}</div>}
      <hr className="divider" />
      {useModel && (
        <>
          <Field label="Base URL do LM Studio"><Input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setModel(""); setModelReady(false); }} /></Field>
          <LmStudioModelPicker
            baseUrl={baseUrl}
            onSelection={(selection) => {
              setModel(selection?.modelId || "");
              setModelReady(Boolean(selection?.ready));
            }}
          />
        </>
      )}
      <Field label="Pergunta"><Textarea rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} /></Field>
      <div className="action-row">
        <Button onClick={() => query()} busy={busy} disabled={useModel && !modelReady}><Search size={16} /> Buscar e responder</Button>
        <Button variant="secondary" onClick={askByVoice}><Mic size={16} /> Perguntar por voz</Button>
        <Button variant="secondary" onClick={() => answer && speak(answer)} disabled={!answer}><Volume2 size={16} /> Falar resposta</Button>
        <Toggle checked={useModel} onChange={setUseModel} label="Gerar com LM Studio" />
      </div>
      {error && <StatusMessage title="RAG interrompido">{error}</StatusMessage>}
      <div className="metric-row">
        <Metric label="Busca" value={retrieval ? `${retrieval.searchMs} ms` : "—"} />
        <Metric label="Geração" value={generationMs === undefined ? "—" : generationMs ? `${generationMs} ms` : "desativada"} />
        <Metric label="Chunks" value={retrieval?.chunks.length ?? "—"} />
        <Metric label="Fontes usadas" value={retrieval?.sources.length ?? "—"} />
      </div>
      <ResultPanel label="RESPOSTA"><p className="response-text">{answer || "Indexe uma fonte e faça uma pergunta."}</p></ResultPanel>
      {retrieval && (
        <div className="rag-inspector">
          <details open><summary>Chunks recuperados</summary>{retrieval.chunks.map((chunk) => <article key={chunk.id}><header><strong>{chunk.source}</strong><span>score {chunk.score}</span></header><p>{chunk.content}</p></article>)}</details>
          <details><summary>Prompt final enviado ao modelo</summary><pre>{retrieval.prompt}</pre></details>
        </div>
      )}
    </LabFrame>
  );
}
