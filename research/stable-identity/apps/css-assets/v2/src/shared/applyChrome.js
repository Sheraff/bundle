import "../styles/chrome.css"

export function applyChrome(root, { eyebrow, title, summary }) {
  const hero = document.createElement("section")
  hero.className = "chrome-card"
  hero.innerHTML = `
    <p class="page-eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    <p>${summary}</p>
  `
  root.append(hero)
}
