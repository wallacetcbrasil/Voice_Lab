# Research: Voice Architecture Lab

## Decision 1 — Núcleo Node e adaptadores por processo

**Decision**: Express atende HTTP/uploads; `ws` atende realtime educacional; motores locais são
invocados por binário configurado ou por um servidor Python opcional.

**Rationale**: mantém instalação base pequena, oferece erros determinísticos e evita carregar
vários frameworks de ML no processo web.

**Alternatives considered**: Fastify (boa opção, mas menos familiar para laboratório);
Python-only (pior integração com navegador/build); Electron (escopo desnecessário).

## Decision 2 — Cliente nunca chama LM Studio diretamente

**Decision**: todo chat passa pela API local Node, incluindo streaming.

**Rationale**: centraliza CORS, timeout, logs, modelo ativo e futuros segredos. Também evita
configuração de CORS inconsistente entre runtimes.

**Alternatives considered**: chamada direta do browser, rejeitada por segurança e diagnósticos.

## Decision 3 — RAG lexical como baseline

**Decision**: tokenização Unicode, frequência ponderada e sobreposição de chunks em memória.
O contrato reserva `provider` para embeddings futuros.

**Rationale**: funciona offline imediatamente e torna recuperação/prompt inspecionáveis.

**Alternatives considered**: vetor local obrigatório, rejeitado por dependências e pesos extras.

## Decision 4 — Áudio multimodal via backend Python opcional

**Decision**: rotas neutras de Transformers usam um bridge Python isolado quando habilitadas.
O adapter usa `AutoProcessor` e a classe concreta compatível com o checkpoint escolhido. Aliases
antigos permanecem somente para compatibilidade de clientes existentes.

**Rationale**: GGUF e APIs OpenAI-compatible podem expor apenas o caminho textual; recursos
nativos mudam por runtime, conversão e versão do modelo.

**Alternatives considered**: prometer áudio no LM Studio/llama.cpp, tecnicamente incorreto.

## Decision 5 — Realtime inicial separa transporte e conversa por turnos

**Decision**: MediaRecorder envia pequenos WebM chunks por WebSocket; o servidor devolve ACK,
energia informada, sequência e estado. VAD simples fica no cliente. Um segundo modo usa
SpeechRecognition, geração incremental textual e TTS para responder por turnos curtos.

**Rationale**: demonstra transporte de entrada, latência e sessões sem fingir STT/TTS full-duplex.

**Alternatives considered**: WebRTC completo, adiado por exigir sinalização, codecs e motor
audio-to-audio realmente incremental.

## Decision 6 — Design técnico com movimento contido

**Decision**: visual escuro de bancada, gradientes elétricos, sombras em camadas, medidores,
microanimações CSS e ícones consistentes; respeitar redução de movimento.

**Rationale**: expressa “laboratório” sem sacrificar legibilidade ou depender de uma biblioteca
visual extensa.

**Alternatives considered**: Three.js como fundo permanente, rejeitado por custo e distração;
kit visual genérico, rejeitado por reduzir identidade.

## Decision 7 — Segurança e retenção

**Decision**: uploads são processados em memória quando possível; referências de voz usam
diretório temporário e são apagadas após a resposta; limite de 50 MB; nome aleatório; sem
presets de terceiros; consentimento booleano obrigatório.

**Rationale**: reduz superfície de vazamento e torna o comportamento auditável.

**Alternatives considered**: biblioteca persistente de vozes, fora de escopo e insegura por padrão.
