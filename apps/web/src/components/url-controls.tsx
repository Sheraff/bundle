import { formatMetricLabel, sizeMetrics, type SizeMetric } from "../lib/size-metric.js"

export function LinkSelector(props: {
  label: string
  current: string | null | undefined
  options: string[]
  optionLabel?: (option: string) => string
  searchFor: (option: string) => Record<string, unknown>
}) {
  const optionLabel = props.optionLabel ?? ((option: string) => option)

  return (
    <section>
      <h3>{props.label}</h3>
      <p>Current: {props.current ?? "none"}</p>
      {props.options.length === 0 ? (
        <p>No options are available yet.</p>
      ) : (
        <ul>
          {props.options.map((option) => (
            <li key={option}>
              <a href={searchHref(props.searchFor(option))}>{optionLabel(option)}</a>
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
    <section>
      <h3>Metric</h3>
      <p>Current: {formatMetricLabel(props.current)}</p>
      <ul>
        {sizeMetrics.map((metric) => (
          <li key={metric}>
            <a href={searchHref(props.searchFor(metric))}>{formatMetricLabel(metric)}</a>
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
    <nav aria-label="Detail tabs">
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
