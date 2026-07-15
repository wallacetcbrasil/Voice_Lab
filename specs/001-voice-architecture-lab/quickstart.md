# Quickstart de validação

## Base

1. Execute `npm install`.
2. Execute `npm run setup`; confirme que a fila pula itens já reconhecidos e não inicia modelos.
3. Execute `voice-lab start`; confirme que o comando retorna somente após a porta responder e que
   o Companion permanece ativo em segundo plano. Em desenvolvimento, `npm run companion` mantém
   os logs no terminal.
4. Abra `http://127.0.0.1:3333`.
5. Execute `npm run runtime -- status` em outro terminal.

Esperado: tela de instalação e 17 laboratórios disponíveis; Companion e bridges instalados ficam
`inicializados`; LM Studio, llama.cpp e checkpoints permanecem parados/descarregados.

## Navegador

1. Em **TTS Simples**, selecione uma voz e fale um texto.
2. Em **STT Simples**, permita microfone e dite uma frase.

Esperado: síntese funciona; STT transcreve ou explica incompatibilidade.

## LM Studio

1. Execute `npm run runtime -- start lmstudio`.
2. Abra **LM Studio Chat + TTS**, selecione um modelo/quantização compatível e envie
   "Responda apenas: funcionando".
3. Use o botão de leitura e depois execute `npm run runtime -- stop lmstudio`.

Esperado: texto vem do runtime; áudio vem explicitamente do navegador; tempos são registrados.

## RAG

1. Adicione duas fontes manuais com assuntos diferentes.
2. Faça uma pergunta que existe em apenas uma delas.

Esperado: chunks e fonte correta aparecem, junto ao prompt e tempo de busca.

## Consentimento

1. Tente XTTS/OpenVoice/RVC sem marcar consentimento.

Esperado: HTTP 403 e aviso de voz autorizada.

## Realtime experimental

1. Abra **Realtime/Live Experimental**, permita microfone e teste o diagnóstico de transporte.
2. Fale, faça silêncio e observe chunks/ACKs.
3. Com LM Studio configurado, teste o assistente por turnos curtos.

Esperado: medidor/VAD mudam, chunks recebem ACK; o modo assistente responde por STT → LLM → TTS
e a UI deixa claro que ainda não é full-duplex de áudio nativo.

## Testes

Execute `npm run check`, `npm test` e `npm run build`.

Esperado: testes do backend passam e ambos os pacotes compilam.
