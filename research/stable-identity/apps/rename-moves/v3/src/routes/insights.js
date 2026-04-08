import { renderCard } from "../ui/renderCard.js"

export function renderInsights() {
  return renderCard("Insights", [
    ["surface", "renamed-asset"],
    ["route", "insights"],
  ])
}
