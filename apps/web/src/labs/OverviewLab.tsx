import { ArrowRight, AudioLines, BookOpenText, Bot, Mic2, Radio, Repeat2, ScanSearch, Volume2 } from "lucide-react";
import { labById } from "./catalog";
import { LabFrame } from "../components/LabFrame";

const concepts = [
  { icon: <Volume2 />, title: "TTS", formula: "texto → voz", text: "Sintetiza fala. Não escuta e não raciocina." },
  { icon: <Mic2 />, title: "STT / ASR", formula: "voz → texto", text: "Transcreve áudio. Não responde à pergunta." },
  { icon: <Bot />, title: "LLM textual", formula: "texto → texto", text: "Gera linguagem, sem áudio por si só." },
  { icon: <AudioLines />, title: "LLM multimodal", formula: "mídia → texto/áudio", text: "A capacidade exposta depende do runtime." },
  { icon: <Repeat2 />, title: "Pipeline por turnos", formula: "STT → LLM → TTS", text: "Três etapas, com pausas e latência acumulada." },
  { icon: <Radio />, title: "Realtime audio-to-audio", formula: "áudio ⇄ áudio", text: "Streaming, VAD, resposta incremental e barge-in." },
  { icon: <BookOpenText />, title: "Voice cloning", formula: "texto + referência → voz", text: "Gera nova fala parecida com voz autorizada." },
  { icon: <ArrowRight />, title: "Voice conversion", formula: "voz → outro timbre", text: "Transforma áudio existente; não parte de texto." },
  { icon: <ScanSearch />, title: "RAG", formula: "busca → contexto → resposta", text: "Aterra a resposta em fontes recuperadas." },
];

const rows = [
  ["TTS navegador", "Texto", "Áudio", "Parcial", "Talvez", "Não", "Não", "Média", "Muito baixa" , "Feedback e protótipo"],
  ["STT navegador", "Voz", "Texto", "Parcial", "Talvez", "Não", "Não", "Média", "Baixa" , "Ditado e comandos"],
  ["LM Studio", "Texto", "Texto", "Sim", "Não", "Local", "Não", "—", "Média" , "Chat privado"],
  ["STT→LLM→TTS", "Voz", "Voz", "Sim*", "Talvez*", "Local", "Não", "Média", "Média/alta" , "Assistente por turnos"],
  ["GGUF multimodal", "Texto/áudio**", "Texto", "Sim", "Não", "Local", "Não", "Média", "Média" , "Comparar runtimes"],
  ["Transformers multimodal", "Texto/áudio", "Texto", "Sim", "Não", "Local", "Parcial", "Média", "Alta" , "Pesquisa multimodal"],
  ["RAG + voz", "Voz + docs", "Voz", "Sim*", "Talvez*", "Local", "Não", "Média", "Alta" , "Base de conhecimento"],
  ["Voice cloning", "Texto + ref.", "Áudio", "Sim", "Não", "Local", "Não", "Alta", "Alta" , "Voz própria/autorizada"],
  ["RVC", "Áudio", "Áudio", "Sim", "Não", "Local", "Possível", "Média", "Média" , "Conversão de timbre"],
  ["Realtime", "Áudio contínuo", "Áudio contínuo", "Sim*", "Não", "Local", "Sim", "Alta", "Baixa alvo" , "Chamada natural"],
];

export function OverviewLab() {
  return (
    <LabFrame lab={labById.overview}>
      <div className="concept-grid">
        {concepts.map((concept) => <div className="concept-card" key={concept.title}><span>{concept.icon}</span><div><h3>{concept.title}</h3><code>{concept.formula}</code><p>{concept.text}</p></div></div>)}
      </div>
      <div className="table-wrap overview-table">
        <table>
          <thead><tr>{["Modo", "Entrada", "Saída", "Local?", "Internet?", "API?", "Interrupção?", "Naturalidade", "Latência", "Melhor uso"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${cell}-${index}`}><span className={index === 0 ? "table-mode" : ""}>{cell}</span></td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="footnote">* Depende da composição local. ** O suporte de áudio do GGUF depende do build/runtime e não implica geração nativa de fala.</p>
    </LabFrame>
  );
}
