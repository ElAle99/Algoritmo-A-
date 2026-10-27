import React from "react";
import { createRoot } from "react-dom/client";
import ModeApp from "./ModeApp";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ModeApp />
  </React.StrictMode>,
);
