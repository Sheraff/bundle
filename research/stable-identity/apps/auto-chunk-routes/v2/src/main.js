import "./app.css"
import markUrl from "./assets/mark.svg"

const root = document.createElement("main")
root.className = "auto-shell"
root.innerHTML = `
  <header class="hero">
    <img alt="Auto chunk" src="${markUrl}">
    <div>
      <p class="eyebrow">Auto chunk fixture</p>
      <h1>Natural chunking v2</h1>
    </div>
  </header>
`
document.body.append(root)

Promise.all([
  import("./routes/overview.js").then((module) => module.renderOverview),
  import("./routes/alerts.js").then((module) => module.renderAlerts),
]).then(([renderOverview, renderAlerts]) => {
  root.append(renderOverview())
  root.append(renderAlerts())
})
