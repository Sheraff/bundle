import {
	BUNDLE_ARTIFACT_OUTPUT_ENV_VAR,
	DEFAULT_ARTIFACT_RELATIVE_PATH,
	SCHEMA_VERSION_V1,
} from "@workspace/contracts/shared";
import { pluginArtifactV1Schema } from "@workspace/contracts/plugin-artifact";
import { normalizedSnapshotV1Schema } from "@workspace/contracts/normalized-snapshot";
import { uploadScenarioRunEnvelopeV1Schema } from "@workspace/contracts/upload-envelope";
import { uploadScenarioRunAcceptedResponseV1Schema } from "@workspace/contracts/upload-response";
import { comparePageSearchParamsSchema } from "@workspace/contracts/public-routes";
import { prReviewSummaryV1Schema } from "@workspace/contracts/summaries";
import { acknowledgeComparisonItemInputSchema } from "@workspace/contracts/mutations";
import { queueMessageSchema } from "@workspace/contracts/queues";
import { workflowInputSchema } from "@workspace/contracts/workflows";
import { describe, expect, it } from "vitest";

describe("contracts subpath exports", () => {
	it("exposes the intended domain entrypoints", () => {
		expect(BUNDLE_ARTIFACT_OUTPUT_ENV_VAR).toBe("BUNDLE_ARTIFACT_OUTPUT");
		expect(DEFAULT_ARTIFACT_RELATIVE_PATH).toBe(".bundle/artifact.json");
		expect(SCHEMA_VERSION_V1).toBe(1);
		expect(pluginArtifactV1Schema).toBeDefined();
		expect(normalizedSnapshotV1Schema).toBeDefined();
		expect(uploadScenarioRunEnvelopeV1Schema).toBeDefined();
		expect(uploadScenarioRunAcceptedResponseV1Schema).toBeDefined();
		expect(comparePageSearchParamsSchema).toBeDefined();
		expect(prReviewSummaryV1Schema).toBeDefined();
		expect(acknowledgeComparisonItemInputSchema).toBeDefined();
		expect(queueMessageSchema).toBeDefined();
		expect(workflowInputSchema).toBeDefined();
	});
});
