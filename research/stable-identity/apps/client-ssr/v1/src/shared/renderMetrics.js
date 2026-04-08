export function renderMetrics(root, rows) {
  const section = document.createElement("section")
  section.className = "metrics-panel"
  section.innerHTML = rows
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("")
  root.append(section)
}
