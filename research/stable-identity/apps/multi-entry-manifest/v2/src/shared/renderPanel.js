export function renderPanel({ eyebrow, title, description, rows }) {
  const section = document.createElement("section")
  section.className = "panel-card"

  const listItems = rows
    .map(([label, value]) => `<li><span>${label}</span><strong>${value}</strong></li>`)
    .join("")

  section.innerHTML = `
    <p class="shell-eyebrow">${eyebrow}</p>
    <h2>${title}</h2>
    <p>${description}</p>
    <ul>${listItems}</ul>
  `

  return section
}
