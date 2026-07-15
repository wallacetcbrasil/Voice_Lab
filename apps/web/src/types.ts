export type Naturalness = "Baixa" | "Média" | "Alta";

export interface LabDefinition {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  category: "Preparação" | "Fundamentos" | "Runtimes" | "Conhecimento" | "Voz local" | "Experimental" | "Sistema";
  description: string;
  truth: string;
  flow: string[];
  local: string;
  browser: string;
  external: string;
  tools: string[];
  errors: string[];
  naturalness: Naturalness;
}

export interface ExperimentResult {
  id: string;
  modeId: string;
  modeName: string;
  timestamp: string;
  runtime: string;
  model: string;
  stt: string;
  tts: string;
  status: "success" | "error" | "partial";
  totalMs?: number;
  firstTokenMs?: number;
  searchMs?: number;
  acceptsVoice: boolean;
  generatesVoice: boolean;
  notes: string[];
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; hint?: string; requestId?: string };
}
