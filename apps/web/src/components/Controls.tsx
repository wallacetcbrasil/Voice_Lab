import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input select" {...props} />;
}

export function Button({ children, variant = "primary", busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger"; busy?: boolean }) {
  return <button className={`button button-${variant}`} {...props} disabled={props.disabled || busy}>{busy && <LoaderCircle className="spin" size={16} />}{children}</button>;
}

export function StatusMessage({ type = "error", title, children }: { type?: "error" | "success" | "info"; title: string; children?: ReactNode }) {
  const Icon = type === "success" ? CheckCircle2 : AlertCircle;
  return <div className={`status-message status-${type}`} role={type === "error" ? "alert" : "status"}><Icon size={17} /><div><strong>{title}</strong>{children && <p>{children}</p>}</div></div>;
}

export function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`metric ${accent ? "metric-accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function ResultPanel({ label = "RESULTADO", children, muted }: { label?: string; children: ReactNode; muted?: boolean }) {
  return <div className={`result-panel ${muted ? "result-muted" : ""}`}><span className="section-label">{label}</span><div>{children}</div></div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-ui" /><span>{label}</span></label>;
}

export function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}<strong>{value.toFixed(1)}</strong></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

export function LongOperationNotice({ active, title, detail }: { active: boolean; title: string; detail: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const started = Date.now();
    const update = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return null;
  return (
    <div className="long-operation" role="status" aria-live="polite">
      <LoaderCircle className="spin" />
      <div><strong>{title} · {elapsed} s</strong><p>{detail}</p><div className="indeterminate-progress"><span /></div></div>
    </div>
  );
}
