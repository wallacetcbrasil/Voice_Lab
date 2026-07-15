export type ServiceStatus = "ready" | "disabled" | "unavailable" | "experimental" | "error";

export type InstallationStage = "not-installed" | "installed" | "initialized";
export type RuntimeState = "stopped" | "running" | "on-demand" | "not-applicable" | "error";
export type ModelState = "not-required" | "missing" | "available" | "unloaded" | "loaded" | "error";

export interface InstallationState {
  installed: boolean;
  detail?: string;
}

export interface RuntimeDiagnostic {
  state: RuntimeState;
  detail?: string;
  url?: string;
}

export interface ModelDiagnostic {
  state: ModelState;
  detail?: string;
}

export interface LifecycleDiagnostic {
  stage: InstallationStage;
  installation: InstallationState;
  runtime: RuntimeDiagnostic;
  model: ModelDiagnostic;
  startCommand?: string;
  stopCommand?: string;
  conflictGroup?: string;
}

export interface ServiceCapability extends Partial<LifecycleDiagnostic> {
  id: string;
  label: string;
  enabled: boolean;
  status: ServiceStatus;
  detail: string;
  installHint: string;
  features: string[];
  configuredBy?: "environment" | "auto" | "none" | "built-in";
  detectedPath?: string;
  searchedPaths?: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  category: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  durationMs?: number;
  runtime?: string;
  model?: string;
  payloadSummary?: string;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    requestId?: string;
  };
}
