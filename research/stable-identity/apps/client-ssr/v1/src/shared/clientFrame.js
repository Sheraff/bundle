import { formatBytes } from "./formatBytes.js"
import { renderMetrics } from "./renderMetrics.js"

export function renderClientFrame(root, { badgeUrl, title }) {
  const hero = document.createElement("section")
  hero.className = "hero-panel"
  hero.innerHTML = `
    <img alt="Client badge" class="hero-badge" src="${badgeUrl}">
    <div>
      <p class="hero-eyebrow">Environment fixture</p>
      <h1>${title}</h1>
      <p>Hydration payload budget: ${formatBytes(18240)}</p>
    </div>
  `
  root.append(hero)
  renderMetrics(root, [
    ["consumer", "client"],
    ["stream", "hydration"],
    ["payload", formatBytes(18240)],
  ])
}
