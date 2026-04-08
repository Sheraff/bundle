import { renderPanel } from "../ui/renderPanel.js"

export function renderSettings() {
  return renderPanel("Settings", [
    ["surface", "moved-file"],
    ["route", "settings"],
  ])
}
