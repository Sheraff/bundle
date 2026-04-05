import { renderPanel } from '../shared/renderPanel.js';

export function renderSettings() {
  return renderPanel('Settings', [
    ['surface', 'baseline'],
    ['route', 'settings'],
  ]);
}
