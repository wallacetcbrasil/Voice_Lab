# Implementation Plan: Voice Architecture Lab

**Branch**: `001-voice-architecture-lab` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

## Summary

Construir um monorepo local com cliente React/Vite, API Node/Express e adaptadores opcionais
para runtimes/modelos externos. O núcleo cobre browser TTS/STT, chat OpenAI-compatible, RAG
lexical, métricas, logs, comparativo, transporte realtime e conversa por turnos curtos. Integrações
pesadas retornam contratos reais e diagnósticos até que seus binários/modelos sejam habilitados.

## Technical Context

**Language/Version**: TypeScript 5.x em Node.js 22+; ambientes Python isolados 3.9–3.11
conforme a compatibilidade de cada motor

**Primary Dependencies**: React, Vite, Express, ws, multer, pdf-parse, Zod, Vitest, Lucide

**Storage**: memória para experimentos/logs/RAG; arquivos temporários locais efêmeros

**Testing**: Vitest + Supertest; build TypeScript; validação manual guiada no navegador

**Target Platform**: frontend estático na Vercel + Companion Windows local; Chrome/Edge
recomendados; Linux/macOS compatíveis no núcleo

**Project Type**: frontend web publicável + Companion local e bridges Python isolados

**Performance Goals**: UI interativa a 60 fps; saúde em <5 s; busca lexical em <1 s para 10 MB;
streaming textual exibido incrementalmente; sem cópia desnecessária de áudio no frontend

**Constraints**: zero serviço pago obrigatório; sem segredo no cliente; modelos opcionais;
arquivos de voz efêmeros; suporte variável de navegador e runtime explicitamente reportado

**Scale/Scope**: usuário local único, 17 laboratórios, 16 rotas HTTP, 1 WebSocket, até 50 MB/upload

## Constitution Check

- PASS — ferramentas distinguem `not-installed`, `installed` e `initialized`; modelos têm estado separado.
- PASS — integrações têm adaptadores separados e contratos uniformes.
- PASS — consentimento obrigatório e limpeza de amostras fazem parte do contrato.
- PASS — logs, métricas e comparativo são requisitos transversais.
- PASS — testes cobrem API base, fallback, RAG, segurança e WebSocket.
- PASS — bridges de inferência usam credencial interna efêmera e não a expõem ao frontend.
- PASS — realtime usa transporte, pipeline curto e cancelamento reais; não existe sucesso simulado.
- PASS — UI responsiva, teclado e `prefers-reduced-motion` entram no acabamento.

## Project Structure

### Documentation

```text
specs/001-voice-architecture-lab/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/openapi.yaml
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
apps/
├── web/
│   ├── src/components/
│   ├── src/labs/
│   ├── src/services/
│   ├── src/state/
│   └── src/styles/
└── server/
    ├── src/routes/
    ├── src/services/
    ├── src/realtime/
    └── tests/
python/
├── app.py
├── requirements.txt
└── requirements-*.txt
scripts/
├── cli.mjs
├── setup-wizard.mjs
├── companion.mjs
├── runtime.mjs
└── runtime-manifest.mjs
temp/{uploads,outputs,voices}/
```

**Structure Decision**: npm workspaces mantêm cliente e servidor independentes. O frontend pode
ser publicado sem backend remoto; o Companion local concentra pareamento, diagnóstico e runtimes.
Cada motor Python usa um ambiente separado e carregamento preguiçoso de checkpoint.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Nenhuma | — | — |

## Post-Design Constitution Check

PASS. Contratos incluem erros acionáveis, consentimento e exclusão; dados continuam locais;
adapters opcionais não impedem os laboratórios base; verificação contempla build e testes.
