import { formatBytes } from './formatBytes.js';

export function renderMetricsMarkup() {
  return `<ul><li>consumer: server</li><li>render: string</li><li>payload: ${formatBytes(9216)}</li></ul>`;
}
