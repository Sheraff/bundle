import type { PolicyState } from "@workspace/contracts"

export function mapBudgetStateToPolicyState(budgetState: string | null | undefined): PolicyState {
  if (!budgetState || budgetState === "not-configured" || budgetState === "not_configured") {
    return "not_configured"
  }

  if (budgetState === "not-evaluated" || budgetState === "not_evaluated") return "not_evaluated"
  if (budgetState === "pass" || budgetState === "passing") return "pass"
  if (budgetState === "warn" || budgetState === "warning") return "warn"
  if (budgetState === "fail-non-blocking" || budgetState === "fail_non_blocking") return "fail_non_blocking"
  if (budgetState === "fail-blocking" || budgetState === "fail_blocking") return "fail_blocking"
  if (budgetState === "accepted") return "accepted"
  if (budgetState === "disabled") return "disabled"
  if (budgetState === "not-applicable" || budgetState === "not_applicable") return "not_applicable"

  return "not_evaluated"
}

export function policyStateLabel(policyState: PolicyState) {
  switch (policyState) {
    case "accepted":
      return "accepted policy decision"
    case "disabled":
      return "disabled policy"
    case "fail_blocking":
      return "blocking policy failure"
    case "fail_non_blocking":
      return "non-blocking policy failure"
    case "not_applicable":
      return "policy not applicable"
    case "not_configured":
      return "no configured policy"
    case "not_evaluated":
      return "policy not evaluated"
    case "pass":
      return "policy passed"
    case "warn":
      return "policy warning"
  }
}

export function isWarningPolicyState(policyState: PolicyState) {
  return policyState === "fail_non_blocking" || policyState === "not_evaluated" || policyState === "warn"
}
