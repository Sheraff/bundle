const root = document.createElement("main")
root.id = "ambiguous-shared-v2"
document.body.append(root)

Promise.all([
  import("./routes/alpha.js").then((module) => module.renderAlpha),
  import("./routes/beta.js").then((module) => module.renderBeta),
]).then(([renderAlpha, renderBeta]) => {
  root.append(renderAlpha())
  root.append(renderBeta())
})
