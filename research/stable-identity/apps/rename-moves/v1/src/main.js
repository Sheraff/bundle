import "./styles/app.css"

const root = document.createElement("main")
root.className = "rename-shell"
root.innerHTML = "<h1>Rename moves v1</h1>"
document.body.append(root)

Promise.all([
  import("./routes/reports.js").then((module) => module.renderReports),
  import("./routes/settings.js").then((module) => module.renderSettings),
]).then(([renderReports, renderSettings]) => {
  root.append(renderReports())
  root.append(renderSettings())
})
