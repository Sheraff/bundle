import { formatBytes } from "./formatBytes.js"

export function renderClientDiagnostics(root) {
  const section = document.createElement("section")
  section.className = "diag-panel"
  section.innerHTML = `<strong>Deferred diagnostics</strong><span>${formatBytes(6144)}</span>`
  root.append(section)
}
