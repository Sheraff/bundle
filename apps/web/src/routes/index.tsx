import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: HomeRouteComponent,
})

function HomeRouteComponent() {
  return (
    <main>
      <h1>Chunk Scope</h1>
      <p>
        Public repository pages live under <code>/r/:owner/:repo</code>.
      </p>
      <p>This first pass wires the repository overview, scenario page, and compare page.</p>
    </main>
  )
}
