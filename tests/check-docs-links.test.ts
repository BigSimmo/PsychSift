import { describe, expect, it } from "vitest";

import { appliedInboxFallbackPath } from "../scripts/check-docs-links.mjs";

describe("appliedInboxFallbackPath", () => {
  it("maps a pending inbox UUID citation to the applied sibling", () => {
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/edebb730-91d9-42f5-bd93-ca2abb9678bc.json")).toBe(
      "docs/outstanding-issues-inbox/applied/edebb730-91d9-42f5-bd93-ca2abb9678bc.json",
    );
  });

  it("does not wrap an already-applied path or a nested inbox file", () => {
    expect(
      appliedInboxFallbackPath("docs/outstanding-issues-inbox/applied/edebb730-91d9-42f5-bd93-ca2abb9678bc.json"),
    ).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/README.md")).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues.md")).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/not-a-uuid.json")).toBeNull();
  });
});
