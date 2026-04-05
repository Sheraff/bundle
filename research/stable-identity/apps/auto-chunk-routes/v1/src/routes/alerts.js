import { buildRows } from '../shared/buildRows.js';
import { formatDelta } from '../shared/formatDelta.js';
import { renderPanel } from '../shared/renderPanel.js';

export function renderAlerts() {
  return renderPanel('Alerts', buildRows(7, -2).map(([label, value]) => [label, formatDelta(value)]));
}
