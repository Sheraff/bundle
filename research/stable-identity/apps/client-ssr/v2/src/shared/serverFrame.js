import { formatBytes } from './formatBytes.js';
import { renderMetricsMarkup } from './serverMetrics.js';

export function renderServerDocument() {
  return `<!doctype html><html><body><main data-env="ssr"><h1>SSR environment v2</h1><p>Render budget ${formatBytes(10240)}</p>${renderMetricsMarkup()}</main></body></html>`;
}
