import { renderPanel } from "../ui/renderPanel.js"

export function renderInsights() {
  return renderPanel("Insights", [
    ["surface", "moved-file"],
    ["route", "insights"],
  ])
}
