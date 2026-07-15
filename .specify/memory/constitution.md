<!--
Sync Impact Report
- Version change: 1.1.0 -> 2.0.0
- Modified principles:
  - Local-First & Honest Capability Boundaries: simulated capabilities are no longer a product mode.
  - Progressive, Testable Delivery: realtime now requires real transport and a real short-turn path.
  - Consent & Ephemeral Audio: local Python bridges require an internal ephemeral credential.
- Modified constraints: automatic discovery and one sequential installer replace required enable flags;
  heavy checkpoints remain lazy and user-selected.
- Modified quality gates: setup/start/model lifecycle and internal bridge isolation are explicit gates.
- Templates reviewed: .specify/templates/plan-template.md (no change required);
  .specify/templates/spec-template.md (no change required);
  .specify/templates/tasks-template.md (no change required).
- Runtime guidance reviewed: README.md, AGENTS.md and specs/001-voice-architecture-lab/quickstart.md.
- Follow-up TODOs: none.
-->
# Voice Lab Constitution

## Core Principles

### I. Local-First & Honest Capability Boundaries
Every experiment MUST work without a paid service when its documented local dependency is
available. The interface MUST distinguish observed, unavailable, and runtime-dependent
capabilities. Simulated functions, simulated success states, and decorative controls MUST NOT
be shipped. A multimodal model MUST NOT be presented as audio-capable when the selected runtime
exposes only text.

### II. Modular Runtime Adapters
Browser, LM Studio, llama.cpp, and each local audio engine MUST be isolated behind a named
service adapter with a stable contract. Missing binaries or models MUST degrade to an
instructional placeholder without crashing unrelated laboratories.

### III. Consent & Ephemeral Audio
Voice cloning and conversion MUST require explicit consent confirmation and MUST display
"Use apenas vozes próprias ou autorizadas." The project MUST NOT ship public-figure presets,
silently upload audio, or retain samples by default. Temporary voice files MUST be deletable
and excluded from version control. Local Python bridges MUST bind to loopback and MUST reject
inference requests that do not carry the Companion's internal ephemeral credential.

### IV. Observable Experiments
Every runnable experiment MUST expose relevant latency, runtime, model, status, and error
information. Logs MUST summarize payloads without recording secrets or full private audio.
Comparisons MUST state whether measurements are observed, estimated, or unavailable.

### V. Progressive, Testable Delivery
The browser-only learning path, local text runtime path, optional native-audio path, realtime
transport, and real short-turn assistant MUST remain independently testable. Contract and
integration tests MUST cover shared API behavior, error envelopes, consent gates, unavailable-
service fallbacks, WebSocket lifecycle, and cancellation/barge-in.

### VI. Functional UI & Focused Information Architecture
Controls presented as runnable MUST invoke a real browser capability, backend route, runtime,
or explicitly named diagnostic probe. The product MUST NOT present fake functions, simulated
success, decorative locality claims, difficulty levels, or repeated badges that do not help
the user execute or interpret a test. Installation instructions MUST live in one preparation
screen; individual laboratories MAY link to it but MUST remain focused on theory and practice.
Navigation MUST remain identifiable when collapsed, and repeated destinations MUST not appear
in both the sidebar and top bar.

## Technical & Product Constraints

- The web client MUST never receive server-side API keys or secrets.
- The baseline MUST run on Windows with Node.js; Python audio dependencies are optional.
- Tools and native engines MUST be discovered automatically and installed sequentially by one
  setup command, skipping installations that pass their real probe. `.env` MAY provide an
  administrative override but MUST NOT be required for normal discovery.
- Heavy model checkpoints MUST remain user-selected, lazy-loaded, and independently stoppable.
- Browser capability differences MUST be surfaced in the UI with actionable guidance.
- Realtime transport and short-turn pipelines MUST never be labeled as a natural full-duplex call.
- Accessibility, responsive layout, reduced-motion support, and keyboard operation are required.

## Quality Gates

Before a feature is marked complete:

1. Production build and automated tests MUST pass.
2. All 17 laboratories MUST render and explain their actual capability level.
3. Every documented endpoint MUST return a consistent success or actionable error response.
4. Consent-protected routes MUST reject requests without explicit confirmation.
5. README setup/start commands MUST be runnable; setup installs tools without loading heavy
   models, start initializes only the Companion and lightweight bridges, and model runtimes
   remain explicit per-laboratory actions.
6. Temporary audio, uploads, outputs, model weights, and secrets MUST remain git-ignored.
7. Installation probes MUST report the host they actually inspect and distinguish browser,
   backend, runtime, and optional engine availability.
8. Every enabled-looking action MUST have an implemented execution path; diagnostic-only
   actions MUST say exactly what they verify.
9. Python inference bridges MUST reject requests without the internal ephemeral credential,
   while the public frontend MUST never receive that credential.

## Governance

This constitution supersedes informal implementation preferences. Amendments require an
updated Sync Impact Report, semantic version bump, and review of dependent Spec Kit artifacts.
MAJOR changes remove or redefine a principle, MINOR changes add a principle or mandatory gate,
and PATCH changes clarify wording without changing obligations. Every plan and completion
review MUST record compliance or explicitly justify a temporary violation.

**Version**: 2.0.0 | **Ratified**: 2026-07-08 | **Last Amended**: 2026-07-15
