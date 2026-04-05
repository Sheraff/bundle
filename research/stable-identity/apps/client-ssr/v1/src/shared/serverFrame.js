import { formatBytes } from './formatBytes.js';
import { renderMetricsMarkup } from './serverMetrics.js';

export function renderServerDocument() {
  return `<!doctype html><html><body><main data-env="ssr"><h1>SSR environment v1</h1><p>Render budget ${formatBytes(9216)}</p>${renderMetricsMarkup()}</main></body></html>`;
}
