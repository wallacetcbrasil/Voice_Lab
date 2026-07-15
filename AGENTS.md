# Regras de produto do Voice Lab

- Não criar funções falsas, botões decorativos ou estados de sucesso simulados.
- Todo controle executável deve acionar uma capacidade real do navegador, endpoint, runtime ou
  sonda de diagnóstico identificada.
- Não exibir níveis “fácil”, “médio”, “difícil” ou “avançado”.
- Não repetir badges como “100% local por padrão”, “Processamento local por padrão” ou
  “Chamada: ...”. Localidade e capacidade devem ser demonstradas por diagnóstico.
- Centralizar links, comandos e passos de instalação na tela **Instalação e Diagnóstico**.
- Manter os laboratórios focados em explicação, configuração do teste, execução e resultado.
- Diferenciar claramente o host verificado: navegador do usuário, backend local ou backend em nuvem.
- Preferir descoberta automática em caminhos convencionais relativos ao projeto. O frontend não
  deve aceitar caminhos arbitrários do sistema; `.env` é somente override administrativo.
- Blocos de diagnóstico ausentes devem ser clicáveis e abrir comandos diretos, documentação
  oficial, local de execução e limitação atual; scripts auxiliares não devem ser pré-requisito.
- Não repetir destinos de navegação na barra superior quando já estiverem na barra lateral.
- Ao recolher a barra lateral, preservar ícone distinto e nome resumido de cada tela.
- Na publicação padrão, a Vercel entrega somente o frontend; inferência, modelos e arquivos
  permanecem no computador do usuário por meio do Voice Lab Companion em loopback.
- Manter o fluxo base em um único comando do companion. Instalações adicionais devem ocorrer
  somente quando o usuário escolher um laboratório que realmente dependa delas.
- O companion deve escutar somente em `127.0.0.1`, restringir origens, responder a preflight de
  rede local e exigir pareamento efêmero em HTTP e WebSocket.
