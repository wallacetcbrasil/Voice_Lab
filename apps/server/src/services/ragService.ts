import { randomUUID } from "node:crypto";
// A entrada principal do pdf-parse 1.x tenta abrir o fixture do pacote em ESM.
// A implementação interna exporta somente a função de parsing, sem esse side effect.
// @ts-expect-error pdf-parse 1.x não publica declaração para a entrada interna.
import pdf from "pdf-parse/lib/pdf-parse.js";
import { AppError } from "../errors.js";

interface RagChunk {
  id: string;
  documentId: string;
  source: string;
  index: number;
  content: string;
  tokens: Map<string, number>;
}

interface RagDocument {
  id: string;
  name: string;
  type: string;
  characterCount: number;
  createdAt: string;
  chunks: RagChunk[];
}

const documents = new Map<string, RagDocument>();
const stop = new Set(["a", "o", "e", "de", "da", "do", "em", "um", "uma", "para", "com", "que", "the", "and", "of", "to"]);

function tokenize(text: string) {
  const terms = text.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]{2,}/gu) || [];
  const frequencies = new Map<string, number>();
  for (const term of terms) {
    if (!stop.has(term)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  }
  return frequencies;
}

function splitText(text: string, size = 900, overlap = 120) {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + size);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf(". ", end));
      if (boundary > cursor + size * 0.55) end = boundary + 1;
    }
    chunks.push(normalized.slice(cursor, end).trim());
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

async function extract(buffer: Buffer, mime: string, name: string) {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    const result = await pdf(buffer);
    if (!result.text.trim()) throw new AppError(422, "EMPTY_PDF", "O PDF não contém texto extraível.", "Use PDF com camada de texto ou aplique OCR antes.");
    return result.text;
  }
  return buffer.toString("utf8");
}

export async function addDocument(input: { name: string; type: string; text?: string; buffer?: Buffer }) {
  const text = input.text ?? (input.buffer ? await extract(input.buffer, input.type, input.name) : "");
  if (!text.trim()) throw new AppError(422, "EMPTY_DOCUMENT", "A fonte está vazia.");
  const documentId = randomUUID();
  const chunks = splitText(text).map((content, index) => ({
    id: randomUUID(),
    documentId,
    source: input.name,
    index,
    content,
    tokens: tokenize(content),
  }));
  const document: RagDocument = {
    id: documentId,
    name: input.name,
    type: input.type,
    characterCount: text.length,
    createdAt: new Date().toISOString(),
    chunks,
  };
  documents.set(documentId, document);
  return { ...document, chunks: chunks.map(({ tokens: _tokens, ...chunk }) => chunk) };
}

export function queryRag(query: string, limit = 4) {
  const started = performance.now();
  const queryTokens = tokenize(query);
  const ranked = [...documents.values()].flatMap((doc) => doc.chunks).map((chunk) => {
    let score = 0;
    for (const [term, frequency] of queryTokens) {
      const count = chunk.tokens.get(term) || 0;
      score += count * (1 + Math.log1p(frequency));
    }
    return { ...chunk, score: Number(score.toFixed(3)) };
  }).filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 8)));
  const context = ranked.map((chunk, index) => `[Fonte ${index + 1}: ${chunk.source}]\n${chunk.content}`).join("\n\n");
  const prompt = `Use somente o contexto abaixo quando ele contiver a resposta. Se não houver base suficiente, diga isso claramente.\n\n${context || "(nenhum trecho relevante)"}\n\nPergunta: ${query}`;
  return {
    provider: "lexical-memory",
    chunks: ranked.map(({ tokens: _tokens, ...chunk }) => chunk),
    sources: [...new Set(ranked.map((chunk) => chunk.source))],
    prompt,
    searchMs: Math.round((performance.now() - started) * 100) / 100,
    documentCount: documents.size,
  };
}

export function clearRag() {
  documents.clear();
}

export function ragStats() {
  return { documents: documents.size, chunks: [...documents.values()].reduce((sum, doc) => sum + doc.chunks.length, 0) };
}
