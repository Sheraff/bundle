import { formatBytes } from './formatBytes.js';

export function renderMetricsMarkup() {
  return `<ul><li>consumer: server</li><li>render: string</li><li>payload: ${formatBytes(10240)}</li></ul>`;
}
