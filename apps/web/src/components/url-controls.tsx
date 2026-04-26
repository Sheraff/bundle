import type { ReactElement, ReactNode } from "react"

import "./url-controls.css"

/**
 * Each option is a `<Link>` element written directly at the call site, which
 * is where TanStack's full type-checking against the registered route tree
 * happens. The component just renders the list shell.
 */
export function LinkSelector(props: { label: ReactNode; options: ReactElement[] }) {
  return (
    <section className="selector">
      <h3>{props.label}</h3>
      {props.options.length === 0 ? (
        <p>No options yet</p>
      ) : (
        <ul>
          {props.options.map((option, index) => (
            <li key={option.key ?? index}>{option}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MetricSelector(props: {
  raw: ReactElement
  gzip: ReactElement
  brotli: ReactElement
}) {
  return <LinkSelector label="Metric" options={[props.raw, props.gzip, props.brotli]} />
}

export function TabSelector(props: { tabs: ReactElement[] }) {
  return (
    <nav aria-label="Detail tabs" className="tabs">
      <ul>
        {props.tabs.map((tab, index) => (
          <li key={tab.key ?? index}>{tab}</li>
        ))}
      </ul>
    </nav>
  )
}
