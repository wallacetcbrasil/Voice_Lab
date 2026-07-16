# Voice Lab

Laboratório web para aprender, testar e comparar arquiteturas de voz com IA. A interface pode ser
publicada na Vercel, mas inferência, modelos e arquivos continuam no computador do usuário por meio
do **Voice Lab Companion**, que escuta apenas em `127.0.0.1`.

> TTS transforma texto em voz. STT transforma voz em texto. Um LLM textual transforma texto em
> texto. LM Studio e llama.cpp são runtimes locais, não sistemas completos de voz. Um modelo
> multimodal só oferece as modalidades que o runtime realmente expõe. `STT → LLM → TTS` continua
> sendo um pipeline por turnos, não uma chamada full-duplex.

## O que funciona

- TTS do navegador com voz, idioma, velocidade, pitch, volume e latência.
- STT do navegador com transcrição parcial/final e diagnóstico de compatibilidade.
- Chat textual e streaming via LM Studio ou `llama-server` OpenAI-compatible.
- Voz por turnos: STT → LM Studio → TTS, com medição por fase.
- Descoberta somente-leitura de modelos de áudio no LM Studio, com escolha e carregamento explícito
  de uma única quantização antes de qualquer inferência.
- Modelo multimodal via LM Studio, llama.cpp ou Python/Transformers.
- RAG local com texto, TXT, Markdown e PDF com camada de texto.
- Piper, Kokoro, Faster-Whisper, XTTS-v2, OpenVoice V2 e RVC em ambientes Python isolados.
- Realtime experimental com captura contínua, VAD, chunks, WebSocket, resposta incremental por
  turnos curtos e interrupção do TTS ao detectar uma nova fala.
- Comparativo, logs sanitizados, diagnóstico real e três estados para cada ferramenta:
  **não instalada**, **instalada** e **inicializada**.
- Controles de carga para LM Studio, Kokoro, Faster-Whisper, XTTS, OpenVoice e Transformers, com
  cronômetro real, confirmação por sonda e inferência bloqueada enquanto o checkpoint não estiver
  na memória.

## Como o carregamento de modelos funciona

Instalar uma ferramenta não carrega seu modelo. Em cada laboratório que usa checkpoint pesado,
selecione o modelo e clique em **Carregar modelo**. O Voice Lab espera o runtime concluir, consulta
o estado real e só então libera o botão de inferência. Isso evita que o primeiro prompt acumule
carregamento + geração e expire, além de impedir a carga acidental de várias quantizações.

Alguns runtimes não fornecem percentual de carga. Nesses casos a interface mostra animação
indeterminada e o tempo decorrido medido, sem fabricar uma porcentagem. O primeiro uso também pode
baixar arquivos oficiais e, portanto, demorar mais que os usos seguintes.

## Arquitetura publicada

```text
Vercel — frontend React/Vite estático
  ├─ microfone, reprodução, SpeechRecognition e speechSynthesis
  └─ cliente HTTP/WebSocket
                    │ origem exata + preflight PNA + token efêmero
                    ▼
PC do usuário — Voice Lab Companion em 127.0.0.1:3333
  ├─ RAG, logs e diagnóstico
  ├─ LM Studio em 127.0.0.1:1234
  ├─ llama-server em 127.0.0.1:8080
  └─ bridges Python isolados em 127.0.0.1:8000 e 8101–8106
                    │
                    ▼
              CPU/GPU e modelos locais
```

A Vercel entrega somente a interface. Ela não executa os modelos, não recebe caminhos do sistema e
não armazena os áudios usados nos testes. Uma página publicada só acessa o Companion depois que a
origem exata é autorizada pelo usuário.

## Início rápido

### Pré-requisito

Instale [Node.js 22 ou superior](https://nodejs.org/en/download). Chrome ou Edge oferecem a melhor
compatibilidade atual com as APIs de voz do navegador.

### 1. Instalar e verificar as ferramentas

No PowerShell do computador que executará os modelos:

```powershell
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab setup
```

O comando faz uma pré-verificação completa e percorre as ferramentas sequencialmente. Cada item já
reconhecido é pulado; somente o que estiver ausente é instalado e validado. Falhar em um motor não
impede a verificação dos seguintes. Nenhum servidor ou checkpoint pesado é iniciado.

No Windows, a instalação persistente fica em `%LOCALAPPDATA%\VoiceLab` e usa um ambiente Python
isolado por motor. Isso evita misturar dependências incompatíveis de XTTS, OpenVoice e RVC.

### 2. Inicializar o Companion e os bridges

Para uma interface local:

```powershell
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start
```

Para uma interface publicada, autorize **somente a origem exata** antes de iniciar:

```powershell
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start --origin=https://SEU-PROJETO.vercel.app
```

O comando aguarda a sonda real da aplicação e imprime:

```text
Voice Lab inicializado: http://127.0.0.1:3333
```

O Companion e os bridges continuam ativos em segundo plano, portanto o terminal pode ser fechado.
Use `voice-lab stop` para encerrá-los. O comando **não** abre LM Studio, não inicia llama.cpp e não
carrega checkpoints. Para acompanhar a saída continuamente, use `voice-lab start --foreground`;
nesse modo, `CTRL+C` encerra os processos gerenciados.

### Estados exibidos no diagnóstico

| Estado | Significado |
|---|---|
| Não instalado | o executável ou a importação real não foi reconhecido no host do Companion |
| Instalado | a ferramenta foi validada, mas seu processo não está atendendo |
| Inicializado | a sonda real do processo respondeu |

Modelos possuem um estado separado: ausente, disponível, descarregado ou carregado. Um bridge
inicializado não significa que um checkpoint está ocupando RAM/VRAM.

## Comandos do runtime

Use o mesmo prefixo público em todos os exemplos:

```powershell
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab status
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start --foreground
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start lmstudio
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab stop lmstudio
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start llama --hf=ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab stop llama
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab stop
```

- `status` executa sondas sem carregar modelos.
- `start lmstudio` inicia a API do LM Studio sem selecionar um modelo.
- `start llama --hf=...` inicia somente o GGUF escolhido e pode baixá-lo na primeira execução.
- `stop lmstudio` descarrega os modelos do LM Studio e encerra sua API.
- `stop llama` encerra apenas o processo registrado como iniciado pelo Voice Lab.
- `stop` encerra os processos gerenciados do llama.cpp, LM Studio, Companion e bridges.

LM Studio e llama.cpp concorrem por memória. Ao iniciar um deles, o CLI encerra primeiro o runtime
conflitante **gerenciado pelo Voice Lab**. Um processo externo nunca é morto à força; nesse caso, o
CLI informa que ele deve ser encerrado no terminal ou aplicativo que o iniciou.

## Modelos leves de referência

O Voice Lab não distribui presets de terceiros e não carrega pesos durante a instalação. A tela
**Instalação e Diagnóstico** oferece links para modelos compatíveis e deixa a escolha no laboratório.

| Laboratório | Referência inicial | Observação |
|---|---|---|
| LM Studio / llama.cpp | [`ggml-org/Voxtral-Mini-3B-2507-GGUF`](https://huggingface.co/ggml-org/Voxtral-Mini-3B-2507-GGUF), `Q4_K_M` | áudio/texto → texto; usa `mmproj`; conecte um TTS para ouvir |
| Python/Transformers | [`mistralai/Voxtral-Mini-3B-2507`](https://huggingface.co/mistralai/Voxtral-Mini-3B-2507) | checkpoint original; áudio/texto → texto |
| Faster-Whisper | `tiny` | baixo consumo para validar STT local |
| Piper | `pt_BR-faber-medium` | voz ONNX baixada pelo instalador |
| Kokoro | `hexgrad/Kokoro-82M` | pesos baixados somente na primeira geração |
| XTTS-v2 | `tts_models/multilingual/multi-dataset/xtts_v2` | exige aceite da licença e voz autorizada |
| OpenVoice V2 | [`myshell-ai/OpenVoiceV2`](https://huggingface.co/myshell-ai/OpenVoiceV2) | conversor e vozes-base baixados somente ao carregar |
| RVC | arquivo `.pth` próprio ou autorizado | conversão de fala; não é TTS |

O GGUF de referência aceita entrada de áudio e gera texto; não gera fala nativa. O suporte real pode
variar por versão do LM Studio/llama.cpp, backend de GPU e metadados do modelo. A interface mede o
runtime em vez de deduzir capacidade pelo nome.

## LM Studio

1. Instale/verifique as ferramentas com `voice-lab setup`.
2. Abra o laboratório **LM Studio + TTS** ou **Modelo multimodal no LM Studio**.
3. Inicie a API com `voice-lab start lmstudio` ou pelo botão oficial do aplicativo.
4. A interface consulta os metadados locais em modo somente-leitura.
5. Escolha um modelo que declare áudio e exatamente uma quantização.
6. Clique em **Carregar modelo**, aguarde a confirmação real e execute o teste.

O Voice Lab não envia prompts durante a descoberta e nunca chama uma carga em massa. Se uma
variante já estiver carregada, ela é priorizada. Caso contrário, o botão chama o endpoint nativo de
carga para uma única variante e o chat permanece bloqueado até a API confirmar a instância.

Documentação: [servidor local do LM Studio](https://lmstudio.ai/docs/developer/core/server).

## llama.cpp

LM Studio aberto não inicializa `llama-server`: são processos independentes e usam portas
diferentes. O laboratório de llama.cpp espera a API em `http://127.0.0.1:8080/v1`.

O caminho recomendado no Windows é:

```powershell
npx --yes --package=github:wallacetcbrasil/Voice_Lab voice-lab start llama --hf=ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M
```

O argumento `-hf` do llama.cpp obtém o GGUF e o projetor multimodal exigido. O processo fica
registrado para que `voice-lab stop llama` possa encerrá-lo com segurança. Para usar outro GGUF,
substitua `organização/repositório:quantização` por uma referência Hugging Face compatível.

Builds manuais continuam suportados; consulte a
[instalação oficial](https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md) e o
[README do llama-server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## Python/Transformers

O instalador prepara as bibliotecas em um ambiente isolado e o Companion inicia o bridge em
`127.0.0.1:8106`. O checkpoint não é baixado nem carregado nesse momento. No laboratório, clique em
**Carregar modelo**; o adapter então usa `AutoProcessor` e a classe de geração compatível antes de
liberar a inferência.

As rotas públicas são:

- `POST /api/transformers/text`;
- `POST /api/transformers/audio`;
- `POST /api/transformers/audio-to-audio`.

O checkpoint de referência produz texto. Portanto, `audio-to-audio` retorna capacidade não
suportada até que um modelo com saída nativa de áudio seja configurado; a aplicação não simula um
arquivo de voz.

## Motores locais de áudio

### Piper

TTS offline por CLI e voz ONNX. O instalador baixa `pt_BR-faber-medium.onnx` e seu JSON para a área
persistente. `POST /api/tts/piper` gera WAV temporário e o remove depois da resposta.

Projeto atual: [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl). Confira também a
licença específica de cada voz.

### Kokoro

TTS Python local. O pacote é instalado pelo setup; os pesos são obtidos sob demanda na primeira
geração. A interface consulta o catálogo suportado pelo adapter e oferece seletores de idioma e voz;
não é necessário memorizar identificadores. Compare o resultado com Piper e TTS do navegador.

### Faster-Whisper

STT local usado quando a API do navegador não existe ou quando se deseja manter a transcrição no
host. O padrão é CPU + `int8` e checkpoint `tiny`; CUDA é um override administrativo opcional.

### XTTS-v2

TTS com clonagem. A interface exige uma referência de voz, texto, idioma e consentimento.
Antes do primeiro download, também exige a leitura e a confirmação explícita da
[Coqui Public Model License](https://tts-hub.github.io/cpml/). O bridge não tenta responder a um
prompt de licença sem terminal; após o aceite, os arquivos ficam na área persistente do Voice Lab.

Um bom áudio de referência tem aproximadamente 6–15 segundos, uma única pessoa, volume estável,
pouco ruído/eco, sem música e voz própria ou explicitamente autorizada. A aplicação aceita arquivo
ou gravação do microfone e não o envia para serviços externos.

### OpenVoice V2

Clonagem de timbre e controle de estilo. O setup instala apenas o runtime. Ao clicar em
**Carregar modelo**, o bridge baixa o conversor e as vozes-base do repositório oficial
[`myshell-ai/OpenVoiceV2`](https://huggingface.co/myshell-ai/OpenVoiceV2), em uma revisão fixada pelo
projeto, e depois carrega somente o idioma selecionado. Consulte também o
[guia oficial](https://github.com/myshell-ai/OpenVoice/blob/main/docs/USAGE.md). O checkpoint oficial
não oferece voz-base em português; para texto em português, use XTTS-v2.

### RVC

Voice conversion: recebe uma fala gravada e converte seu timbre. Não transforma texto em voz. O
runtime é instalado, mas o usuário fornece um arquivo `.pth` próprio ou autorizado. Consulte o
[repositório oficial](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion).

> Use somente sua própria voz ou uma voz com autorização explícita. Não há presets para pessoas
> públicas ou terceiros reais.

## RAG + voz

1. Adicione texto manual ou arquivo `.txt`, `.md` ou `.pdf` com camada de texto.
2. Indexe a fonte.
3. Digite ou fale a pergunta.
4. Use a recuperação lexical sozinha ou conecte o LM Studio para gerar a resposta.
5. Inspecione fontes, chunks, score, prompt final e latências.

O índice é local e em memória. PDF escaneado precisa de OCR antes do upload.

## Realtime/Live experimental

Há dois modos reais:

- **Diagnóstico de transporte**: MediaRecorder → VAD simples → chunks → WebSocket → ACK/latência.
- **Assistente por turnos curtos**: SpeechRecognition contínuo → LM Studio incremental → TTS do
  navegador, com interrupção da fala quando uma nova entrada é detectada.

O segundo modo responde, mas ainda não é audio-to-audio full-duplex. STT/modelo não consomem os
chunks de áudio incrementalmente e a saída não é um stream de áudio nativo. Esses limites aparecem
explicitamente no laboratório; nenhum estado de sucesso é simulado.

## Conceitos comparados

| Modo | Entrada | Saída | Limite principal |
|---|---|---|---|
| TTS | texto | áudio | não escuta nem responde perguntas |
| STT/ASR | áudio | texto | não gera resposta |
| LLM textual | texto | texto | não produz voz sozinho |
| LLM multimodal | texto/imagem/áudio/vídeo | depende do modelo | o runtime pode expor somente parte |
| Pipeline por turnos | voz | voz | espera o fim de cada etapa |
| Realtime audio-to-audio | áudio contínuo | áudio contínuo | exige streaming, VAD, baixa latência e barge-in |
| Voice cloning | texto + referência | nova fala | gera uma fala, não converte o áudio inteiro |
| Voice conversion | fala existente | fala convertida | não começa em texto |
| RAG | pergunta + base | contexto/resposta | recupera conhecimento; não treina o LLM |

## Desenvolvimento local

```powershell
git clone https://github.com/wallacetcbrasil/Voice_Lab.git
cd Voice_Lab
npm install
npm run setup       # verifica/instala tudo, sem iniciar modelos
npm run companion   # inicia Companion + bridges instalados
```

Comandos de qualidade:

```powershell
npm run check
npm test
npm run build
npm run setup:check
npm run runtime -- status
npm run runtime -- stop all
```

`.env` não é requisito. A descoberta padrão usa `%LOCALAPPDATA%\VoiceLab` no Windows e
`~/.voice-lab` nos demais sistemas. Copie `.env.example` somente para overrides administrativos,
como origem publicada exata, outra porta, dispositivo CUDA ou caminhos fora da instalação padrão.

## Publicação do frontend na Vercel

O `vercel.json` já define o build Vite e o fallback da SPA:

1. importe o repositório na Vercel;
2. publique sem criar backend remoto;
3. no PC do usuário, execute `voice-lab start --origin=https://URL-EXATA.vercel.app`;
4. feche o terminal se desejar; o Companion permanece ativo até `voice-lab stop`.

Não use curingas de origem. Preview deployments têm URLs diferentes e precisam ser autorizados
explicitamente antes do teste.

## API do Companion

```text
POST   /api/pair
GET    /api/health
GET    /api/setup/status
GET    /api/lmstudio/models
GET    /api/lmstudio/audio-models
POST   /api/lmstudio/models/load
POST   /api/lmstudio/chat
POST   /api/models/status
POST   /api/models/load
GET    /api/llama-cpp/diagnose
POST   /api/rag/upload
POST   /api/rag/query
DELETE /api/rag
POST   /api/tts/piper
POST   /api/tts/kokoro
POST   /api/stt/whisper
POST   /api/voice-clone/xtts
POST   /api/voice-clone/openvoice
POST   /api/voice-conversion/rvc
POST   /api/transformers/text
POST   /api/transformers/audio
POST   /api/transformers/audio-to-audio
POST   /api/realtime/session
WS     /api/realtime
GET    /api/logs
DELETE /api/logs
DELETE /api/voice-samples
```

Com exceção de `/api/pair`, as rotas exigem o token efêmero emitido pelo Companion. O WebSocket
exige o mesmo token e valida a origem.

## Segurança e privacidade

- O Companion escuta somente em `127.0.0.1`.
- CORS e preflight de Private Network Access aceitam apenas origens exatas autorizadas.
- O pareamento emite um token aleatório válido somente enquanto o processo estiver aberto.
- O Companion cria outro token efêmero, nunca enviado ao frontend, para autenticar os bridges Python internos.
- API keys são opcionais e permanecem no backend local.
- O frontend não aceita caminhos arbitrários do sistema.
- Uploads são limitados, mantidos em memória ou temporários e removidos após o uso.
- `.env`, modelos, pesos, uploads, outputs e amostras estão ignorados pelo Git.
- Logs removem tokens, áudio/binários e payloads grandes.
- Nenhum áudio é enviado a serviço externo sem alteração explícita do projeto.
- Clonagem e conversão exigem consentimento no frontend e no backend.

## Erros comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| `PAIRING_FAILED` | origem publicada não autorizada ou Companion parado | defina `WEB_ORIGINS` com a URL exata e reinicie `voice-lab start` |
| `RUNTIME_OFFLINE` | LM Studio/llama-server parado | inicie somente o runtime do laboratório |
| modelo não carregado | ferramenta inicializada, checkpoint ausente/descarregado | escolha o modelo, clique em **Carregar modelo** e aguarde a confirmação |
| carregamento demora vários minutos | download inicial, leitura dos pesos ou alocação de RAM/VRAM | mantenha o Companion aberto; o cronômetro continua ativo e usa timeout dedicado |
| `PYTHON_BACKEND_OFFLINE` | bridge não instalado ou não iniciado | rode `voice-lab setup`, depois `voice-lab start` |
| microfone `not-allowed` | permissão bloqueada | libere o microfone para a origem atual |
| PDF vazio | não há camada de texto | aplique OCR antes do upload |
| GPU sem memória | modelo/contexto grandes ou dois runtimes ativos | pare o runtime anterior e reduza modelo/contexto |
| formato de áudio incompatível | codec/container não aceito pelo motor | converta para WAV mono antes do teste |

## Limitações conhecidas

- SpeechRecognition varia entre navegador, sistema e idioma.
- O fallback RAG atual é lexical, não semântico.
- Checkpoints de XTTS, OpenVoice e RVC têm licenças e requisitos próprios.
- O modelo Transformers de referência é pesado e gera texto, não áudio nativo.
- O modo realtime responde por turnos curtos; não há full-duplex de áudio nativo.
- Recursos multimodais variam entre builds do runtime e backends de GPU.

## Spec Kit

O projeto mantém especificação, plano, decisões, contrato e tarefas em
[`specs/001-voice-architecture-lab`](specs/001-voice-architecture-lab) e foi estruturado com o
[GitHub Spec Kit](https://github.com/github/spec-kit).

## Licença

Código distribuído sob a [licença MIT](LICENSE). Modelos, vozes e runtimes de terceiros mantêm suas
próprias licenças; confira cada uma antes de redistribuir ou publicar resultados.

Projeto de [Wallace Correia Brasil](https://www.linkedin.com/in/wallacecorreiabrasil/) ·
[GitHub](https://github.com/wallacetcbrasil).

---

**Aviso obrigatório:** use apenas vozes próprias ou autorizadas.
