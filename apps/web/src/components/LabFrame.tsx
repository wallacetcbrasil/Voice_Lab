import { AlertTriangle, Box, ChevronRight, Cpu, Globe2, Laptop } from "lucide-react";
import type { LabDefinition } from "../types";
import type { ReactNode } from "react";

export function LabFrame({ lab, children }: { lab: LabDefinition; children: ReactNode }) {
  return (
    <article className="lab-page">
      <header className="lab-hero">
        <div>
          <span className="eyebrow">LAB {String(lab.number).padStart(2, "0")} · {lab.category}</span>
          <h1>{lab.title}</h1>
          <p>{lab.description}</p>
        </div>
      </header>

      <section className="truth-card">
        <span className="truth-pulse" aria-hidden />
        <div><strong>O que este modo realmente faz</strong><p>{lab.truth}</p></div>
      </section>

      <section className="flow-card" aria-label="Fluxo do laboratório">
        <div className="section-label">FLUXO DO SINAL</div>
        <div className="flow-line">
          {lab.flow.map((step, index) => (
            <div className="flow-segment" key={`${step}-${index}`}>
              <span>{step}</span>
              {index < lab.flow.length - 1 && <ChevronRight aria-hidden size={17} />}
            </div>
          ))}
        </div>
      </section>

      <div className="dependency-grid">
        <InfoTile icon={<Laptop size={17} />} label="Roda localmente" value={lab.local} />
        <InfoTile icon={<Globe2 size={17} />} label="Depende do navegador" value={lab.browser} />
        <InfoTile icon={<Cpu size={17} />} label="Modelo / runtime" value={lab.external} />
        <InfoTile icon={<Box size={17} />} label="Ferramentas" value={lab.tools.join(" · ")} />
      </div>

      <section className="workspace-card">
        <div className="workspace-heading">
          <div>
            <span className="section-label">BANCADA DE TESTE</span>
            <h2>Execute e observe</h2>
          </div>
        </div>
        {children}
      </section>

      <details className="errors-card">
        <summary><AlertTriangle size={16} /> Erros comuns e como interpretar</summary>
        <ul>{lab.errors.map((error) => <li key={error}>{error}</li>)}</ul>
      </details>
    </article>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="info-tile"><span className="info-icon">{icon}</span><div><small>{label}</small><p>{value}</p></div></div>;
}
