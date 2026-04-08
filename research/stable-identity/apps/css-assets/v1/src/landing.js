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
  summary: "One shared CSS asset should split later without relying on chunk labels.",
})
mountTokens(root, ["token-budget", "route-aware", "asset-trace"])
renderShowcase(root, [
  ["Surface", "marketing-landing"],
  ["Theme", "aqua chrome"],
  ["CSS mode", "shared skin"],
])
