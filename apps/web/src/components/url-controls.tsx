import { formatMetricLabel, sizeMetrics, type SizeMetric } from "../lib/size-metric.js"
import "./url-controls.css"

export function LinkSelector(props: {
  label: string
  current: string | null | undefined
  options: string[]
  optionLabel?: (option: string) => string
  searchFor: (option: string) => Record<string, unknown>
}) {
  const optionLabel = props.optionLabel ?? ((option: string) => option)

  return (
    <section className="selector">
      <h3>
        {props.label}
        <small>{props.current ?? "none"}</small>
      </h3>
      {props.options.length === 0 ? (
        <p>No options yet</p>
      ) : (
        <ul>
          {props.options.map((option) => (
            <li key={option}>
              <a
                href={searchHref(props.searchFor(option))}
                aria-current={option === props.current ? "true" : undefined}
              >
                {optionLabel(option)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MetricSelector(props: {
  current: SizeMetric
  searchFor: (metric: SizeMetric) => Record<string, unknown>
}) {
  return (
    <section className="selector">
      <h3>
        Metric
        <small>{formatMetricLabel(props.current)}</small>
      </h3>
      <ul>
        {sizeMetrics.map((metric) => (
          <li key={metric}>
            <a
              href={searchHref(props.searchFor(metric))}
              aria-current={metric === props.current ? "true" : undefined}
            >
              {formatMetricLabel(metric)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TabSelector<TTab extends string>(props: {
  current: TTab
  tabs: readonly TTab[]
  searchFor: (tab: TTab) => Record<string, unknown>
}) {
  return (
    <nav aria-label="Detail tabs" className="tabs">
      <ul>
        {props.tabs.map((tab) => (
          <li key={tab}>
            <a href={searchHref(props.searchFor(tab))} aria-current={tab === props.current ? "page" : undefined}>
              {tab}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function searchHref(search: Record<string, unknown>) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue
    if (key === "base" || key === "head") {
      params.set(key, JSON.stringify(String(value)))
      continue
    }
    params.set(key, String(value))
  }

  const query = params.toString()
  return query.length > 0 ? `?${query}` : "?"
}
