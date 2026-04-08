import "../styles/token-strip.css"

export function mountTokens(root, values) {
  const list = document.createElement("ul")
  list.className = "token-strip"
  list.innerHTML = values.map((value) => `<li>${value}</li>`).join("")
  root.append(list)
}
