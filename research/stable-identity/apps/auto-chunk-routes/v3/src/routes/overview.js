import { buildRows } from "../shared/buildRows.js"
import { describeTrend } from "../shared/describeTrend.js"
import { formatDelta } from "../shared/formatDelta.js"
import { renderPanel } from "../shared/renderPanel.js"

export function renderOverview() {
  return renderPanel(
    "Overview",
    buildRows(12, 4).map(([label, value]) => [
      `${label} ${describeTrend(value)}`,
      formatDelta(value),
    ]),
  )
}
