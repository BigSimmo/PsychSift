import { describe, expect, it } from "vitest";

import {
  COLLIDING_PRESENTATION_WORKFLOW_IDS,
  disambiguatePresentationWorkflowId,
  isCollidingPresentationWorkflowId,
  PRESENTATION_WORKFLOW_ID_PREFIX,
  stripPresentationWorkflowPrefix,
} from "@/lib/differentials/presentation-workflows";

describe("presentation-workflows ID disambiguation (#HNJF5X)", () => {
  it("defines the expected prefix and the three colliding presentation workflow IDs", () => {
    expect(PRESENTATION_WORKFLOW_ID_PREFIX).toBe("workflow-pres-");
    expect(COLLIDING_PRESENTATION_WORKFLOW_IDS).toEqual([
      "substance-intoxication",
      "substance-withdrawal",
      "depression",
    ]);
  });

  it("accurately identifies colliding presentation workflow IDs", () => {
    expect(isCollidingPresentationWorkflowId("substance-intoxication")).toBe(true);
    expect(isCollidingPresentationWorkflowId("substance-withdrawal")).toBe(true);
    expect(isCollidingPresentationWorkflowId("depression")).toBe(true);

    expect(isCollidingPresentationWorkflowId("delirium")).toBe(false);
    expect(isCollidingPresentationWorkflowId("mania")).toBe(false);
    expect(isCollidingPresentationWorkflowId("")).toBe(false);
    expect(isCollidingPresentationWorkflowId("workflow-pres-depression")).toBe(false);
  });

  it("prefixes colliding presentation workflow IDs with workflow-pres-", () => {
    expect(disambiguatePresentationWorkflowId("depression")).toBe("workflow-pres-depression");
    expect(disambiguatePresentationWorkflowId("substance-intoxication")).toBe("workflow-pres-substance-intoxication");
    expect(disambiguatePresentationWorkflowId("substance-withdrawal")).toBe("workflow-pres-substance-withdrawal");
  });

  it("leaves non-colliding presentation workflow IDs unchanged", () => {
    expect(disambiguatePresentationWorkflowId("delirium")).toBe("delirium");
    expect(disambiguatePresentationWorkflowId("psychosis")).toBe("psychosis");
    expect(disambiguatePresentationWorkflowId("")).toBe("");
  });

  it("is idempotent and does not double-prefix already disambiguated IDs", () => {
    const once = disambiguatePresentationWorkflowId("depression");
    const twice = disambiguatePresentationWorkflowId(once);
    expect(twice).toBe("workflow-pres-depression");
  });

  it("supports custom prefix parameter for disambiguation and stripping", () => {
    expect(disambiguatePresentationWorkflowId("depression", "custom-")).toBe("custom-depression");
    expect(stripPresentationWorkflowPrefix("custom-depression", "custom-")).toBe("depression");
  });

  it("strips presentation workflow prefix safely", () => {
    expect(stripPresentationWorkflowPrefix("workflow-pres-depression")).toBe("depression");
    expect(stripPresentationWorkflowPrefix("workflow-pres-substance-withdrawal")).toBe("substance-withdrawal");
    expect(stripPresentationWorkflowPrefix("delirium")).toBe("delirium");
    expect(stripPresentationWorkflowPrefix("")).toBe("");
  });
});
