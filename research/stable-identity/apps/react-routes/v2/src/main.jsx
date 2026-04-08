import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./app.css"
import { App } from "./App.jsx"

const mountNode = document.createElement("div")
mountNode.id = "react-routes-fixture"
document.body.appendChild(mountNode)

createRoot(mountNode).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
