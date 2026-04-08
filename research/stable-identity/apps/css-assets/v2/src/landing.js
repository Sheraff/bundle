import "./styles/landing.css"
import { applyChrome } from "./shared/applyChrome.js"
import { mountTokens } from "./shared/mountTokens.js"
import { renderShowcase } from "./shared/renderShowcase.js"

const root = document.createElement("main")
root.className = "page-shell landing-shell"
document.body.appendChild(root)

applyChrome(root, {
  eyebrow: "CSS asset fixture",
  title: "Landing entry",
  summary: "The old shared CSS is intentionally split into shell and token strips.",
})
mountTokens(root, ["token-budget", "route-aware", "asset-trace"])
renderShowcase(root, [
  ["Surface", "marketing-landing"],
  ["Theme", "signal chrome"],
  ["CSS mode", "split shared skin"],
])
