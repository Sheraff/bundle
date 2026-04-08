export function normalizeRequiredInput(value?: string) {
	return value?.trim() ?? "";
}

export function normalizeTrimmedInput(value?: string) {
	const normalizedValue = value?.trim();
	return normalizedValue ? normalizedValue : undefined;
}

export function parsePositiveInteger(value: unknown) {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}

	const numericValue = Number.parseInt(value, 10);
	return Number.isInteger(numericValue) && numericValue > 0
		? numericValue
		: null;
}

export function formatIssues(issues: readonly { message: string }[]) {
	return issues.map((issue) => issue.message).join("; ");
}
