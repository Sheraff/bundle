import { renderCard } from "../ui/renderCard.js"

export function renderPreferences() {
  return renderCard("Preferences", [
    ["surface", "renamed-asset"],
    ["route", "preferences"],
  ])
}
