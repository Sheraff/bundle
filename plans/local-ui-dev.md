# Local UI Development

Run a deterministic local data loop before staging validation:

1. `pnpm web:seed`
2. `pnpm --filter @workspace/web dev`
3. Open `http://127.0.0.1:5173/r/acme/widget?lens=entry-js-direct-css&metric=gzip`
4. Optional browser check: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 pnpm web:test:e2e`

The seed inserts a small public `acme/widget` repository with two branch commits, one scenario, one comparison, summary rows, series points, and normalized snapshot objects in local R2. Staging remains the final integration check.
