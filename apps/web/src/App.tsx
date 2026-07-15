import { AudioLines, AudioWaveform, BookOpen, BrainCircuit, ChevronLeft, ChevronRight, FileSearch, FlaskConical, Github, Headphones, Languages, Linkedin, Menu, MessagesSquare, Mic, PackageCheck, Radio, Server, Sparkles, Speech, Terminal, TestTubes, UserRoundCog, Volume2, WandSparkles, Waves, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { labs } from "./labs/catalog";
import type { LabDefinition } from "./types";
import { OverviewLab } from "./labs/OverviewLab";
import { SttBrowserLab, TtsBrowserLab } from "./labs/BrowserLabs";
import { LmChatLab, QwenLlamaLab, QwenLmLab, QwenPythonLab, TurnVoiceLab } from "./labs/ChatLabs";
import { RagLab } from "./labs/RagLab";
import { KokoroLab, OpenVoiceLab, PiperLab, RvcLab, XttsLab } from "./labs/AudioEngineLabs";
import { RealtimeLab } from "./labs/RealtimeLab";
import { ComparisonLab, DebugLab } from "./labs/SystemLabs";
import { SetupLab } from "./labs/SetupLab";
import { api } from "./services/apiClient";
import { fetchSetupStatus, flattenSetupStatus } from "./services/setupService";

const views: Record<string, () => React.JSX.Element> = {
  setup: SetupLab,
  overview: OverviewLab,
  "tts-browser": TtsBrowserLab,
  "stt-browser": SttBrowserLab,
  "lm-chat": LmChatLab,
  "turn-voice": TurnVoiceLab,
  "qwen-lm": QwenLmLab,
  "qwen-llama": QwenLlamaLab,
  "qwen-python": QwenPythonLab,
  rag: RagLab,
  piper: PiperLab,
  kokoro: KokoroLab,
  xtts: XttsLab,
  openvoice: OpenVoiceLab,
  rvc: RvcLab,
  realtime: RealtimeLab,
  comparison: ComparisonLab,
  debug: DebugLab,
};

const labIcons: Record<string, React.JSX.Element> = {
  setup: <PackageCheck />, overview: <BookOpen />, "tts-browser": <Volume2 />, "stt-browser": <Mic />,
  "lm-chat": <MessagesSquare />, "turn-voice": <Speech />, "qwen-lm": <BrainCircuit />,
  "qwen-llama": <Terminal />, "qwen-python": <Languages />, rag: <FileSearch />, piper: <AudioWaveform />,
  kokoro: <Waves />, xtts: <UserRoundCog />, openvoice: <WandSparkles />, rvc: <Headphones />,
  realtime: <Radio />, comparison: <TestTubes />, debug: <Server />,
};

export default function App() {
  const initial = location.hash.replace("#", "") || "setup";
  const [activeId, setActiveId] = useState(views[initial] ? initial : "setup");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [backend, setBackend] = useState<"ready" | "partial" | "offline" | "checking">("checking");
  const ActiveView = views[activeId] || OverviewLab;
  const activeIndex = labs.findIndex((lab) => lab.id === activeId);
  const grouped = useMemo(() => labs.reduce<Record<string, LabDefinition[]>>((groups, lab) => {
    (groups[lab.category] ||= []).push(lab);
    return groups;
  }, {}), []);

  useEffect(() => {
    location.hash = activeId;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeId]);

  useEffect(() => {
    const check = () => Promise.all([api("/api/health"), fetchSetupStatus()])
      .then(([, setup]) => {
        const probes = flattenSetupStatus(setup);
        const allToolsInstalled = probes.length > 0 && probes.every((probe) => probe.stage !== "not-installed");
        const companionRunning = probes.find((probe) => probe.id === "pythonBridge")?.stage === "initialized";
        setBackend(allToolsInstalled && companionRunning ? "ready" : "partial");
      })
      .catch(() => setBackend("offline"));
    void check();
    const id = window.setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const navigate = (id: string) => { setActiveId(id); setMobileOpen(false); };
  const previous = labs[activeIndex - 1];
  const next = labs[activeIndex + 1];

  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <div className="ambient ambient-one" aria-hidden />
      <div className="ambient ambient-two" aria-hidden />
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><AudioLines /></div>
          {!collapsed && <div><strong>VOICE LAB</strong><span>LOCAL AI WORKBENCH</span></div>}
          <button className="icon-button close-mobile" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X /></button>
        </div>
        <nav aria-label="Laboratórios">
          {Object.entries(grouped).map(([category, items]) => (
            <section className="nav-group" key={category}>
              {!collapsed && <h2>{category}</h2>}
              {items?.map((lab) => <button key={lab.id} className={activeId === lab.id ? "active" : ""} onClick={() => navigate(lab.id)} title={lab.title}>
                <span className="nav-icon">{labIcons[lab.id] || <FlaskConical />}</span>
                {!collapsed ? <><span className="nav-number">{String(lab.number).padStart(2, "0")}</span><span>{lab.shortTitle}</span></> : <span className="nav-collapsed-label">{lab.shortTitle}</span>}
                {activeId === lab.id && <i />}
              </button>)}
            </section>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className={`backend-pill ${backend}`}><span />{!collapsed && <>{backend === "ready" ? "Ferramentas instaladas" : backend === "partial" ? "Configuração parcial" : backend === "offline" ? "Companion offline" : "Verificando"}</>}</div>
          <button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>{collapsed ? <ChevronRight /> : <ChevronLeft />}</button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu /></button>
          <div className="breadcrumb"><span>Voice Lab</span><ChevronRight /><strong>{labs[activeIndex]?.shortTitle}</strong></div>
          <div className="topbar-right">
            <span className="author-name">Wallace Correia Brasil</span>
            <a className="social-link" href="https://www.linkedin.com/in/wallacecorreiabrasil/" target="_blank" rel="noreferrer" aria-label="LinkedIn de Wallace Correia Brasil"><Linkedin /></a>
            <a className="social-link" href="https://github.com/wallacetcbrasil" target="_blank" rel="noreferrer" aria-label="GitHub de Wallace Correia Brasil"><Github /></a>
          </div>
        </header>
        <div className="content-wrap">
          <ActiveView />
          <footer className="page-navigation">
            {previous ? <button onClick={() => navigate(previous.id)}><ChevronLeft /><span><small>Anterior</small>{previous.shortTitle}</span></button> : <span />}
            <div><Sparkles size={14} /> laboratório {activeIndex + 1} de {labs.length}</div>
            {next ? <button onClick={() => navigate(next.id)}><span><small>Próximo</small>{next.shortTitle}</span><ChevronRight /></button> : <span />}
          </footer>
        </div>
      </main>
    </div>
  );
}
