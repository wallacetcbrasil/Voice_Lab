import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ExperimentResult } from "../types";

interface ExperimentStoreValue {
  results: ExperimentResult[];
  addResult: (result: Omit<ExperimentResult, "id" | "timestamp">) => void;
  clearResults: () => void;
}

const ExperimentContext = createContext<ExperimentStoreValue | null>(null);

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<ExperimentResult[]>(() => {
    try { return JSON.parse(localStorage.getItem("voice-lab-results") || "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem("voice-lab-results", JSON.stringify(results.slice(0, 200))), [results]);
  const value = useMemo(() => ({
    results,
    addResult: (result: Omit<ExperimentResult, "id" | "timestamp">) =>
      setResults((current) => [{ ...result, id: crypto.randomUUID(), timestamp: new Date().toISOString() }, ...current]),
    clearResults: () => setResults([]),
  }), [results]);
  return <ExperimentContext.Provider value={value}>{children}</ExperimentContext.Provider>;
}

export function useExperiments() {
  const value = useContext(ExperimentContext);
  if (!value) throw new Error("ExperimentProvider ausente");
  return value;
}
