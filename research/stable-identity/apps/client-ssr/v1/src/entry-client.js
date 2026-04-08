import "./styles/client.css"
import badgeUrl from "./assets/client-badge.svg"
import { renderClientFrame } from "./shared/clientFrame.js"

const root = document.createElement("main")
root.className = "client-shell"
document.body.appendChild(root)

renderClientFrame(root, { badgeUrl, title: "Client environment v1" })
import("./shared/clientDiagnostics.js").then(({ renderClientDiagnostics }) => {
  renderClientDiagnostics(root)
})
