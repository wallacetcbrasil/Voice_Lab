# Tasks: Voice Architecture Lab

**Input**: Design documents from `specs/001-voice-architecture-lab/`

## Phase 1: Setup

- [x] T001 Initialize npm workspaces and scripts in package.json
- [x] T002 [P] Configure TypeScript web package in apps/web/package.json
- [x] T003 [P] Configure TypeScript server package in apps/server/package.json
- [x] T004 [P] Add environment, temporary-data, editor, and build exclusions in .gitignore
- [x] T005 Add local configuration contract in .env.example

## Phase 2: Foundational

- [x] T006 Build typed API/error/config/log foundations in apps/server/src
- [x] T007 Build React shell, navigation, shared laboratory cards, and theme in apps/web/src
- [x] T008 [P] Implement frontend API, TTS, STT, recorder, and experiment store clients in apps/web/src/services
- [x] T009 [P] Add reusable local-service adapter and capability registry in apps/server/src/services

## Phase 3: User Story 1 — Fundamental browser labs (P1)

**Independent Test**: Run browser TTS and capability-aware STT without a local model.

- [x] T010 [US1] Implement overview comparison and teaching flows in apps/web/src/labs
- [x] T011 [US1] Implement browser TTS laboratory with voice controls in apps/web/src/labs
- [x] T012 [US1] Implement browser STT laboratory with partial/final transcript in apps/web/src/labs

## Phase 4: User Story 2 — Runtime and turn-based voice labs (P1)

**Independent Test**: Send local OpenAI-compatible chat and execute STT→chat→TTS.

- [x] T013 [US2] Implement LM Studio and llama.cpp clients/routes in apps/server/src
- [x] T014 [US2] Implement streaming chat, LM Studio, turn voice, and multimodal runtime labs in apps/web/src/labs
- [x] T015 [P] [US2] Implement neutral Transformers proxy routes and Python adapter in apps/server/src and python/app.py

## Phase 5: User Story 3 — RAG and local audio engines (P2)

**Independent Test**: Index text, retrieve chunks, and receive actionable missing-engine diagnostics.

- [x] T016 [US3] Implement lexical RAG ingestion/query and PDF parsing in apps/server/src/services/ragService.ts
- [x] T017 [US3] Implement RAG voice laboratory with sources, chunks, prompt and timings in apps/web/src/labs
- [x] T018 [US3] Implement Piper, Kokoro, Whisper, XTTS, OpenVoice, and RVC adapters/routes in apps/server/src
- [x] T019 [US3] Implement local TTS, cloning, style, and conversion laboratories in apps/web/src/labs
- [x] T020 [US3] Enforce consent and temporary voice deletion in apps/server/src

## Phase 6: User Story 4 — Realtime and comparison (P2)

**Independent Test**: Stream microphone chunks to WebSocket and aggregate measured results.

- [x] T021 [US4] Implement realtime sessions and WebSocket acknowledgements in apps/server/src/realtime
- [x] T022 [US4] Implement microphone chunking, simple VAD, latency UI, transport diagnostics, and short-turn assistant in apps/web/src/labs
- [x] T023 [US4] Implement automatic comparison table and rankings in apps/web/src/labs

## Phase 7: User Story 5 — Diagnostics (P3)

**Independent Test**: View live health, memory, services, request logs, and install hints.

- [x] T024 [US5] Implement health, logs, sanitization, timeouts, and status routes in apps/server/src
- [x] T025 [US5] Implement live logs/debug panel and service probes in apps/web/src/labs

## Phase 8: Tests, documentation, and polish

- [x] T026 [P] Add backend contract, security, RAG, and fallback tests in apps/server/tests
- [x] T027 [P] Add Python dependency manifests and adapter comments in python
- [x] T028 [P] Add cross-platform setup, Companion, lifecycle, and environment-check CLIs in scripts
- [x] T029 Write complete Portuguese guide and architecture notes in README.md
- [x] T030 Add reduced-motion, responsive, focus, and final visual polish in apps/web/src/styles
- [x] T031 Install dependencies and verify npm test and npm run build
- [x] T032 Run Spec Kit quickstart and mark implementation tasks complete in specs/001-voice-architecture-lab/tasks.md

## Phase 9: Installation experience and navigation refinement

- [x] T033 Add centralized installation and host-aware diagnostics screen before fundamentals
- [x] T034 Add real setup status endpoint for base tools, runtimes, and configured audio engines
- [x] T035 Remove per-lab installation walkthroughs, difficulty labels, and decorative capability badges
- [x] T036 Give laboratories distinct icons and preserve compact labels in collapsed navigation
- [x] T037 Reuse the STT microphone interaction in turn-based voice
- [x] T038 Remove duplicate Debug shortcut and add author LinkedIn/GitHub identity
- [x] T039 Validate tests, production build, browser rendering, and closed development ports

## Phase 10: Public Companion lifecycle

- [x] T040 Add sequential pre-check/install that skips every recognized tool
- [x] T041 Isolate Python environments and initialize bridges without loading checkpoints
- [x] T042 Add safe LM Studio/llama.cpp start-stop conflict handling
- [x] T043 Add exact-origin pairing, loopback binding, HTTP/WebSocket token validation, and PNA preflight
- [x] T044 Document Vercel frontend + local Companion, three-stage diagnostics, and neutral model examples

## Phase 11: Security, real realtime, and public distribution

- [x] T045 Protect every Python inference bridge with an internal ephemeral credential unavailable to the frontend
- [x] T046 Replace realtime simulation with real transport, short-turn STT→LLM→TTS, cancellation, and observed capability states
- [x] T047 Add package metadata, privacy exclusions, exact-origin CLI support, security headers, and cross-platform CI
- [x] T048 Run final end-to-end verification, publish the public GitHub repository, validate the Git package command, and close local ports

## Phase 12: Persistent public start lifecycle

- [x] T049 Add a detached Companion launcher, foreground diagnostic mode, lifecycle regression test, and updated public instructions

## Phase 13: Explicit model loading lifecycle

- [x] T050 Add real LM Studio and Python model load/status endpoints with dedicated long-operation timeouts
- [x] T051 Block inference until runtime verification and show real elapsed, indeterminate loading states across model-backed labs
- [x] T052 Update contracts and documentation, run the full build/test suite, and validate the rebuilt Companion

## Phase 14: Explicit turn capture

- [x] T053 Replace press-and-hold capture with click-to-start/click-to-send, preserve transcript across browser recognition restarts, and validate the full build/test suite

## Dependencies & Execution Order

Setup precedes foundations. US1 and US2 establish the MVP. US3 and US4 depend only on shared
foundations; US5 observes all adapters. Tests and documentation validate the complete set.

## Parallel Opportunities

Package setup, client services, multimodal adapter, tests, Python manifests, and scripts touch
independent files and may be implemented concurrently after their prerequisites.

## Implementation Strategy

Deliver browser fundamentals first, then local text runtime and turn-based voice. Add RAG/audio
contracts, realtime transport/short turns, comparison, and diagnostics incrementally. A missing optional
model never blocks the base product.
