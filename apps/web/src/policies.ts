import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { ulid } from "ulid"

import { getDb, schema } from "./db/index.js"
import type { AppBindings } from "./env.js"

export type PolicyResultState =
  | "accepted"
  | "disabled"
  | "fail_blocking"
  | "fail_non_blocking"
  | "not_evaluated"
  | "pass"
  | "warn"

export type PolicyEvaluationComparison = {
  currentTotalBrotliBytes: number
  currentTotalGzipBytes: number
  currentTotalRawBytes: number
  deltaTotalBrotliBytes: number | null
  deltaTotalGzipBytes: number | null
  deltaTotalRawBytes: number | null
  id: string
  repositoryId: string
  seriesId: string
}

export type PolicyEvaluationSeries = {
  entrypointKey: string
  environment: string
  lens: string
  scenarioId: string
}

type PolicyRow = typeof schema.policies.$inferSelect
type AcceptedDecisionRow = typeof schema.acceptedPolicyDecisions.$inferSelect

export async function evaluatePoliciesForComparison(
  env: AppBindings,
  input: {
    comparison: PolicyEvaluationComparison
    evaluatedAt: string
    series: PolicyEvaluationSeries
  },
) {
  const db = getDb(env)
  const policies = (await db
    .select()
    .from(schema.policies)
    .where(
      and(
        eq(schema.policies.repositoryId, input.comparison.repositoryId),
        eq(schema.policies.scenarioId, input.series.scenarioId),
      ),
    )).filter((policy) => policyMatchesSeries(policy, input.series))

  const existingResults = await db
    .select({ id: schema.policyResults.id })
    .from(schema.policyResults)
    .where(eq(schema.policyResults.comparisonId, input.comparison.id))

  if (existingResults.length > 0) {
    await db
      .update(schema.acceptedPolicyDecisions)
      .set({ policyResultId: null, updatedAt: input.evaluatedAt })
      .where(inArray(schema.acceptedPolicyDecisions.policyResultId, existingResults.map((result) => result.id)))
  }

  await db.delete(schema.policyResults).where(eq(schema.policyResults.comparisonId, input.comparison.id))

  if (policies.length === 0) {
    return { budgetState: "not-configured", resultStates: [] as PolicyResultState[] }
  }

  const decisions = await db
    .select()
    .from(schema.acceptedPolicyDecisions)
    .where(
      and(
        eq(schema.acceptedPolicyDecisions.repositoryId, input.comparison.repositoryId),
        inArray(schema.acceptedPolicyDecisions.policyId, policies.map((policy) => policy.id)),
        or(
          isNull(schema.acceptedPolicyDecisions.comparisonId),
          eq(schema.acceptedPolicyDecisions.comparisonId, input.comparison.id),
        ),
      ),
    )

  const resultStates: PolicyResultState[] = []

  for (const policy of policies) {
    const actualValue = actualPolicyValue(policy, input.comparison)
    const acceptedDecision = activeAcceptedDecision(policy, decisions, input.evaluatedAt, input.comparison.id)
    const result = evaluatePolicyResult(policy, actualValue, acceptedDecision)
    const message = policyResultMessage(policy, actualValue, result)
    const resultId = ulid()

    resultStates.push(result)

    await db.insert(schema.policyResults).values({
      id: resultId,
      repositoryId: input.comparison.repositoryId,
      policyId: policy.id,
      comparisonId: input.comparison.id,
      seriesId: input.comparison.seriesId,
      actualValue,
      thresholdBytes: policy.thresholdBytes,
      result,
      severity: policy.severity,
      message,
      evaluatedAt: input.evaluatedAt,
      createdAt: input.evaluatedAt,
    })

    if (acceptedDecision && !acceptedDecision.policyResultId) {
      await db
        .update(schema.acceptedPolicyDecisions)
        .set({ policyResultId: resultId, updatedAt: input.evaluatedAt })
        .where(eq(schema.acceptedPolicyDecisions.id, acceptedDecision.id))
    }
  }

  return { budgetState: aggregatePolicyState(resultStates), resultStates }
}

export function policySentence(policy: Pick<PolicyRow, "blocking" | "entrypointKey" | "environment" | "lens" | "operator" | "sizeMetric" | "thresholdBytes">) {
  const consequence = policy.blocking ? "Block" : "Warn"
  const operator = policy.operator === "total_greater_than" ? "is greater than" : "grows by more than"
  const scope = [policy.environment, policy.entrypointKey].filter(Boolean).join(" / ") || "all outputs"
  const lens = policy.lens ?? "any What's counted"

  return `${consequence} if ${policy.sizeMetric} size for ${lens} on ${scope} ${operator} ${policy.thresholdBytes} B.`
}

function policyMatchesSeries(policy: PolicyRow, series: PolicyEvaluationSeries) {
  return (
    (!policy.environment || policy.environment === series.environment) &&
    (!policy.entrypointKey || policy.entrypointKey === series.entrypointKey) &&
    (!policy.lens || policy.lens === series.lens)
  )
}

function actualPolicyValue(policy: PolicyRow, comparison: PolicyEvaluationComparison) {
  if (policy.operator === "total_greater_than") {
    if (policy.sizeMetric === "raw") return comparison.currentTotalRawBytes
    if (policy.sizeMetric === "gzip") return comparison.currentTotalGzipBytes
    if (policy.sizeMetric === "brotli") return comparison.currentTotalBrotliBytes
  }

  if (policy.sizeMetric === "raw") return comparison.deltaTotalRawBytes
  if (policy.sizeMetric === "gzip") return comparison.deltaTotalGzipBytes
  if (policy.sizeMetric === "brotli") return comparison.deltaTotalBrotliBytes
  return null
}

function activeAcceptedDecision(
  policy: PolicyRow,
  decisions: AcceptedDecisionRow[],
  evaluatedAt: string,
  comparisonId: string,
) {
  return decisions.find((decision) => {
    if (decision.policyId !== policy.id) return false
    if (decision.comparisonId && decision.comparisonId !== comparisonId) return false
    if (decision.expiresAt && decision.expiresAt <= evaluatedAt) return false
    return true
  }) ?? null
}

function evaluatePolicyResult(
  policy: PolicyRow,
  actualValue: number | null,
  acceptedDecision: AcceptedDecisionRow | null,
): PolicyResultState {
  if (policy.enabled !== 1) return "disabled"
  if (actualValue === null) return "not_evaluated"
  if (actualValue <= policy.thresholdBytes) return "pass"
  if (acceptedDecision) return "accepted"
  if (policy.blocking === 1) return "fail_blocking"
  if (policy.severity === "warning") return "warn"
  return "fail_non_blocking"
}

function aggregatePolicyState(states: PolicyResultState[]) {
  if (states.includes("fail_blocking")) return "fail-blocking"
  if (states.includes("fail_non_blocking")) return "fail-non-blocking"
  if (states.includes("warn")) return "warn"
  if (states.includes("not_evaluated")) return "not-evaluated"
  if (states.includes("accepted")) return "accepted"
  if (states.every((state) => state === "disabled")) return "disabled"
  return "pass"
}

function policyResultMessage(policy: PolicyRow, actualValue: number | null, result: PolicyResultState) {
  if (result === "disabled") return `${policy.name} is disabled.`
  if (actualValue === null) return `${policy.name} could not be evaluated because the selected data is missing.`
  if (result === "pass") return `${policy.name} passed: ${actualValue} B <= ${policy.thresholdBytes} B.`
  if (result === "accepted") return `${policy.name} matched but has an active accepted decision.`
  return `${policy.name} matched: ${actualValue} B > ${policy.thresholdBytes} B.`
}
