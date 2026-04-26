import { Link, createFileRoute } from "@tanstack/react-router"

import "./index.css"

export const Route = createFileRoute("/")({
  component: HomeRouteComponent,
})

const inspectables = [
  "Trends",
  "Scenarios",
  "Compares",
  "Treemaps",
  "Dependency graphs",
  "Build-time waterfalls",
  "Asset & module tables",
  "Budgets",
  "Acknowledgements",
]

function HomeRouteComponent() {
  return (
    <main className="page home">
      <section>
        <h1>Track Vite bundle size across scenarios, branches, and pull requests.</h1>
        <p>
          Chunk Scope ingests your Vite build output, compares it against base branches and prior
          commits, and surfaces every byte that moved — so PRs ship with intent, not surprise
          regressions.
        </p>
        <div>
          <a className="button-link" href="/api/v1/auth/github/start?redirect_to=/app">
            Sign in with GitHub
          </a>
          <Link className="button-secondary" to="/app/setup">
            Setup guide
          </Link>
          <a className="button-secondary" href="https://github.com/Sheraff/bundle-test">
            Smoke repository
          </a>
        </div>
      </section>

      <section>
        <h2>How it works</h2>
        <ol>
          <li>
            Add the Chunk Scope <strong>Vite plugin</strong> to emit normalized bundle snapshots on
            every build.
          </li>
          <li>
            Run the Chunk Scope <strong>GitHub Action</strong> on pushes and pull requests so
            artifacts land in the hosted dashboard.
          </li>
          <li>
            Install the <strong>GitHub App</strong> so PR comments and checks get published
            automatically.
          </li>
          <li>
            Open the <strong>public dashboard</strong> for any repository to inspect trends,
            scenarios, compares, and acknowledgements.
          </li>
        </ol>
      </section>

      <section>
        <h2>Quick start</h2>
        <pre>
          <code>{`pnpm add -D git+https://github.com/Sheraff/bundle.git#staging&path:packages/vite-plugin

// vite.config.ts
import { bundleTracker } from "@chunk-scope/vite-plugin"

export default {
  plugins: [bundleTracker({ scenario: { id: "main-app", kind: "fixture-app" } })],
}`}</code>
        </pre>
        <p>
          Then add the staged GitHub Action from{" "}
          <code>Sheraff/bundle/packages/github-action@staging</code>.
        </p>
      </section>

      <section>
        <h2>What you can inspect</h2>
        <div>
          {inspectables.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section data-tone="warning">
        <h2>Current limits</h2>
        <p>
          Chunk Scope is pre-production. This pass targets public GitHub repositories, Vite builds,
          and the staging package/action channel first.
        </p>
      </section>
    </main>
  )
}
