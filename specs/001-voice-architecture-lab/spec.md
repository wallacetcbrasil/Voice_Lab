# Feature Specification: Voice Architecture Lab

**Feature Branch**: `main`

**Created**: 2026-07-08

**Status**: Approved

**Input**: Aplicação web local didática para testar, comparar e documentar arquiteturas de voz
com IA, com 17 laboratórios, integrações locais opcionais e limites técnicos explícitos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aprender os blocos fundamentais (Priority: P1)

Como estudante de arquiteturas de voz, quero testar TTS e STT do navegador e visualizar os
fluxos para distinguir texto→voz, voz→texto, texto→texto e pipelines por turnos.

**Why this priority**: Entender os blocos atômicos evita atribuir ao LLM capacidades fornecidas
pelo navegador ou por outro serviço.

**Independent Test**: Abrir a aplicação sem modelos locais, executar TTS, verificar a
disponibilidade de STT e navegar pela visão geral.

**Acceptance Scenarios**:

1. **Given** um navegador com síntese de voz, **When** o usuário informa texto e aciona Falar,
   **Then** ouve a voz escolhida e vê a latência.
2. **Given** STT indisponível ou bloqueado, **When** o usuário abre o laboratório,
   **Then** recebe diagnóstico e alternativa local, sem falha global.

---

### User Story 2 - Comparar runtimes e voz por turnos (Priority: P1)

Como desenvolvedor, quero conectar LM Studio ou llama.cpp, conversar por texto ou voz por
turnos e verificar o que o runtime realmente expõe para um modelo multimodal escolhido.

**Why this priority**: É o experimento central para separar modelo, runtime, STT e TTS.

**Independent Test**: Com um endpoint compatível ativo, enviar texto, receber resposta com
streaming quando disponível e reproduzi-la pelo navegador.

**Acceptance Scenarios**:

1. **Given** um runtime local com modelo carregado, **When** o usuário envia texto,
   **Then** recebe resposta, modelo/runtime e medições de tempo.
2. **Given** o runtime não aceita áudio nativo, **When** o usuário tenta o teste multimodal,
   **Then** a limitação é registrada e o fallback STT→texto→TTS é distinguido.

---

### User Story 3 - Explorar RAG e motores de áudio locais (Priority: P2)

Como experimentador, quero indexar fontes locais e comparar Piper, Kokoro, Whisper, XTTS,
OpenVoice e RVC por contratos uniformes, mesmo quando nem todos estiverem instalados.

**Why this priority**: Entrega comparação prática e mantém a aplicação útil antes da instalação
dos modelos pesados.

**Independent Test**: Adicionar texto ao RAG, recuperar chunks e consultar todos os endpoints
desabilitados, obtendo instruções específicas em vez de erros genéricos.

**Acceptance Scenarios**:

1. **Given** fontes TXT, MD, PDF simples ou texto manual, **When** uma pergunta é feita,
   **Then** o sistema mostra chunks, fontes, prompt e tempos.
2. **Given** um motor local ausente ou parado, **When** sua ação é solicitada,
   **Then** o sistema distingue `not-installed`, `installed` e `initialized` e aponta a tela
   central de Instalação e Diagnóstico.
3. **Given** uma rota de clonagem/conversão, **When** não há consentimento explícito,
   **Then** a geração é bloqueada.

---

### User Story 4 - Estudar realtime e comparar resultados (Priority: P2)

Como arquiteto, quero capturar áudio em blocos, observar detecção de silêncio e comparar
latência, naturalidade e privacidade entre os modos.

**Why this priority**: Torna visível por que um pipeline rápido ainda não equivale a uma chamada
full-duplex natural.

**Independent Test**: Iniciar o diagnóstico de transporte, observar blocos/VAD e concluir um turno curto;
depois verificar que o resultado alimenta o comparativo.

**Acceptance Scenarios**:

1. **Given** permissão de microfone, **When** a sessão experimental inicia,
   **Then** blocos, energia, estado de fala e latência aparecem em tempo quase real.
2. **Given** resultados de múltiplos testes, **When** o comparativo é aberto,
   **Then** a tabela e rankings refletem os dados medidos e distinguem estimativas.

---

### User Story 5 - Diagnosticar e instalar dependências opcionais (Priority: P3)

Como mantenedor, quero um painel de saúde e instruções reproduzíveis para saber quais serviços,
binários e modelos estão disponíveis e como corrigir falhas.

**Why this priority**: Modelos locais variam por máquina; diagnósticos acionáveis são essenciais.

**Independent Test**: Iniciar somente o backend base e conferir saúde, logs, status dos serviços,
memória e instruções para cada integração ausente.

**Acceptance Scenarios**:

1. **Given** serviços opcionais ausentes, **When** o painel de debug carrega,
   **Then** mostra cada estado, motivo e próximo passo.
2. **Given** uma requisição com timeout ou formato inválido, **When** ela falha,
   **Then** um erro seguro, categorizado e pesquisável aparece nos logs.

### Edge Cases

- Navegador sem SpeechRecognition, sem vozes carregadas ou com permissão de microfone negada.
- LM Studio desligado, URL inválida, CORS, modelo não carregado ou resposta sem streaming.
- Arquivo vazio, grande, extensão enganosa, PDF sem texto ou áudio incompatível.
- Binário/modelo configurado mas ausente, Python indisponível, GPU sem memória ou timeout.
- WebSocket desconectado durante captura, silêncio contínuo e barge-in não suportado.
- Exclusão de amostra após falha parcial e limpeza de arquivos temporários antigos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST oferecer 17 laboratórios nomeados conforme o escopo solicitado.
- **FR-002**: Cada laboratório MUST exibir fluxo, dependências, controles, resultados, erros
  comuns, latência e proximidade de uma chamada natural.
- **FR-003**: O sistema MUST implementar TTS e STT do navegador com detecção de capacidade.
- **FR-004**: O sistema MUST conversar com APIs locais compatíveis com OpenAI sem expor segredos.
- **FR-004a**: Antes de liberar inferência no LM Studio, o sistema MUST listar modelos locais
  em modo somente-leitura, filtrar famílias compatíveis com áudio, priorizar instâncias já
  carregadas e exigir confirmação explícita da quantização quando ela ainda não está carregada.
- **FR-005**: O sistema MUST distinguir resposta textual do runtime e voz produzida pelo TTS.
- **FR-006**: O sistema MUST medir as fases observáveis do pipeline e registrar os testes.
- **FR-007**: O sistema MUST testar um modelo multimodal compatível em LM Studio, llama.cpp e
  rota Python/Transformers opcional, sem deduzir capacidade somente pelo nome do modelo.
- **FR-008**: O sistema MUST realizar RAG lexical local e aceitar fontes manuais, TXT, MD e PDF.
- **FR-009**: O sistema MUST expor contratos para Piper, Kokoro, Whisper, XTTS, OpenVoice e RVC.
- **FR-010**: Integrações ausentes MUST retornar diagnóstico acionável e não bloquear a aplicação.
- **FR-011**: Clonagem e conversão MUST exigir consentimento explícito e permitir apagar amostras.
- **FR-012**: O sistema MUST transportar captura real em blocos por WebSocket, medir energia/VAD
  e oferecer resposta por turnos curtos sem apresentá-la como full-duplex nativo.
- **FR-013**: O comparativo MUST agregar resultados observados e gerar oito rankings explicados.
- **FR-014**: O painel de debug MUST mostrar requisições, erros, tempos, runtimes e saúde local.
- **FR-015**: Áudio MUST permanecer local por padrão e arquivos temporários MUST ser descartáveis.
- **FR-016**: A aplicação MUST oferecer uma única tela de instalação antes dos fundamentos,
  com links oficiais, comandos, passos e diagnóstico do host efetivamente verificado.
- **FR-017**: A interface MUST distinguir sondas do navegador de sondas executadas no backend,
  inclusive quando o backend estiver implantado em nuvem.
- **FR-018**: A interface MUST NOT apresentar níveis de dificuldade, badges decorativos de
  localidade/chamada ou controles sem caminho funcional implementado.
- **FR-019**: A navegação recolhida MUST preservar nomes resumidos e usar ícones distinguíveis.
- **FR-020**: A documentação MUST separar ferramentas, processos e modelos e descrever
  instalação, validação, limitações e próximos passos.
- **FR-021**: O setup MUST pré-verificar todas as ferramentas, pular as reconhecidas e instalar
  somente as ausentes em sequência, sem iniciar servidor ou checkpoint pesado.
- **FR-022**: O Companion MUST escutar somente em loopback, restringir origens exatas, responder
  ao preflight de rede privada e exigir pareamento efêmero em HTTP e WebSocket.
- **FR-023**: Bridges Python MUST escutar somente em loopback e rejeitar inferência sem uma
  credencial interna efêmera, gerada pelo Companion e nunca entregue ao frontend.

### Key Entities

- **ExperimentResult**: Resultado de uma execução, com modo, runtime, modelo, componentes,
  latências, estado, observações e instante.
- **ServiceCapability**: Estado observado de uma integração, recursos, dependências e instruções.
- **RagDocument/Chunk**: Fonte local, conteúdo textual, metadados e trechos recuperáveis.
- **VoiceSample**: Referência temporária, consentimento, formato, duração e política de exclusão.
- **LogEntry**: Evento sanitizado de requisição, erro, status ou medição.
- **RealtimeSession**: Sessão efêmera, blocos recebidos, VAD, turnos e métricas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário novo diferencia corretamente TTS, STT, LLM, pipeline por turnos,
  cloning, conversion, RAG e realtime após percorrer a visão geral e três testes.
- **SC-002**: Todos os 17 laboratórios abrem e explicam seu estado mesmo sem modelos opcionais.
- **SC-003**: 100% das rotas opcionais ausentes retornam orientação específica, sem falha global.
- **SC-004**: 100% das ações de clonagem e conversão são bloqueadas sem consentimento explícito.
- **SC-005**: Um resultado de cada laboratório executável aparece no comparativo em até 1 segundo.
- **SC-006**: O painel de debug identifica backend, LM Studio e serviços locais em até 5 segundos.
- **SC-007**: Instalação base, build e testes são concluídos por comandos documentados.
- **SC-008**: Nenhum segredo, upload, output, voz ou peso de modelo é incluído no versionamento.
- **SC-009**: 100% das rotas de inferência dos bridges Python rejeitam chamadas sem a credencial
  interna, enquanto as sondas de saúde continuam disponíveis para diagnóstico local.

## Assumptions

- Execução local por uma pessoa, sem autenticação multiusuário na primeira versão.
- Chrome/Edge oferecem a melhor experiência para SpeechRecognition; outros navegadores recebem fallback.
- Dependências são verificadas pelo setup; modelos e checkpoints de terceiros continuam opt-in por
  tamanho, licença, GPU e plataforma.
- Busca lexical em memória é o fallback inicial de RAG; embeddings são aprimoramento configurável.
- Arquivos temporários são removidos após resposta ou por ação explícita de limpeza.
- "Realtime" oferece transporte real e um assistente por turnos curtos, sem prometer áudio
  full-duplex nativo.
