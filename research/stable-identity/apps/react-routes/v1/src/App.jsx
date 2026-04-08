import { lazy, Suspense, useState } from "react"
import logoMark from "./assets/logo-mark.svg"

const Reports = lazy(() => import("./routes/Reports.jsx"))
const Settings = lazy(() => import("./routes/Settings.jsx"))

const routes = {
  reports: Reports,
  settings: Settings,
}

export function App() {
  const [route, setRoute] = useState("reports")
  const CurrentRoute = routes[route]
  const headline = route === "reports" ? "Release metrics" : "Workspace defaults"

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Fixture app</p>
          <h1>{headline}</h1>
          <p className="hero-copy">
            This fixture keeps the entry stable while chunk grouping changes across versions.
          </p>
        </div>
        <img alt="Bundle lab" className="hero-mark" src={logoMark} />
      </header>

      <nav className="route-tabs" aria-label="Fixture routes">
        <button onClick={() => setRoute("reports")} type="button">
          Reports
        </button>
        <button onClick={() => setRoute("settings")} type="button">
          Settings
        </button>
      </nav>

      <Suspense fallback={<p className="loading-state">Loading route chunk…</p>}>
        <CurrentRoute />
      </Suspense>
    </div>
  )
}
