import { renderPanel } from '../shared/renderPanel.js';

export function renderReports() {
  return renderPanel('Reports', [
    ['surface', 'baseline'],
    ['route', 'reports'],
  ]);
}
