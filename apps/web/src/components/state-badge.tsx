export function StateBadge(props: { state: string }) {
  return <span className="pill" data-state={props.state}>{props.state}</span>
}
