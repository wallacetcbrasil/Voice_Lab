import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ExperimentProvider } from "./state/ExperimentStore";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExperimentProvider><App /></ExperimentProvider>
  </StrictMode>,
);
