#!/usr/bin/env node
const [command = "help", target] = process.argv.slice(2).filter((value) => !value.startsWith("--"));

function help() {
  console.log(`Voice Lab

Uso:
  voice-lab setup                    detecta, instala e valida todas as ferramentas
  voice-lab start [--origin=URL]     inicia o Companion; autoriza URL HTTPS/loopback exata
  voice-lab status                   mostra não instalado / instalado / inicializado
  voice-lab start lmstudio           inicia a API do LM Studio sem carregar modelo
  voice-lab stop lmstudio            descarrega modelos e encerra a API do LM Studio
  voice-lab start llama --hf=...     inicia llama.cpp com o GGUF escolhido no laboratório
  voice-lab stop llama               encerra somente o llama.cpp gerenciado pelo Voice Lab
  voice-lab stop                     encerra os processos gerenciados pelo Voice Lab`);
}

if (command === "help" || command === "--help" || command === "-h") {
  help();
} else if (command === "setup") {
  const { runSetupWizard } = await import("./setup-wizard.mjs");
  const { failures } = await runSetupWizard();
  if (failures.length) process.exitCode = 1;
} else if (command === "start" && !target) {
  await import("./companion.mjs");
} else if (command === "status" || command === "stop" || (command === "start" && target)) {
  await import("./runtime.mjs");
} else {
  help();
  process.exitCode = 1;
}
