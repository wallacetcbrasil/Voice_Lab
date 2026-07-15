# Data Model

## ExperimentResult

- `id`: UUID
- `modeId`, `modeName`: laboratório
- `timestamp`: ISO-8601
- `runtime`, `model`, `stt`, `tts`: componentes usados
- `status`: success | error | partial
- `latencies`: captura, primeiro token, geração, áudio, busca e total em ms
- `capabilities`: aceita/gera voz, streaming e interrupção
- `observations`: lista de notas sanitizadas

## ToolLifecycle

- `id`, `label`, `hostRole`
- `stage`: not-installed | installed | initialized
- `installation`: reconhecimento real do pacote, binário ou import
- `runtime`: processo/endpoint sondado, comando seguro de início e parada
- `model`: not-required | missing | available | unloaded | loaded | error | unknown
- `details`, `installHint`, `searchedPaths`
- caminhos são resumidos; o frontend nunca fornece caminho arbitrário
- `features`: texto, áudio, streaming, cloning, conversion

## RagDocument

- `id`, `name`, `type`, `createdAt`, `characterCount`
- `chunks[]`: relação 1:N com RagChunk

## RagChunk

- `id`, `documentId`, `source`, `index`, `content`
- `tokens`: índice interno
- `score`: calculado por consulta

## VoiceSample

- `id`, `originalName`, `mimeType`, `size`, `duration?`
- `consentConfirmed`, `createdAt`, `deletedAt?`
- Transição: received → validated → processing → deleted

## LogEntry

- `id`, `timestamp`, `level`, `category`, `message`
- `requestId?`, `method?`, `path?`, `durationMs?`
- `runtime?`, `model?`, `payloadSummary?`

## RealtimeSession

- `id`, `createdAt`, `status`, `sampleRate?`, `chunkMs`
- `chunksReceived`, `bytesReceived`, `lastActivityAt`
- `vadState`, `latencySamples[]`
- Transição: created → connected → listening/speech/silence → closed

## Validation Rules

- Upload ≤ 50 MB e extensão/MIME permitido para o laboratório.
- `consentConfirmed === true` para XTTS, OpenVoice e RVC.
- URLs externas aceitas apenas para hosts locais por padrão.
- Logs removem `authorization`, chaves, conteúdo binário e prompts excessivos.
- Resultado medido diferencia `observed`, `estimated` e `unavailable`.
