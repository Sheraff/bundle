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
  summary: "The split shared CSS merges back together under a different output layout.",
})
mountTokens(root, ["token-budget", "route-aware", "asset-trace"])
renderShowcase(root, [
  ["Surface", "marketing-landing"],
  ["Theme", "blue fabric"],
  ["CSS mode", "merged fabric"],
])
