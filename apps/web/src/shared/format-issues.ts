export function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join("; ")
}
