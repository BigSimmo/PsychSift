import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyStagingDeployment,
  parseStagingAppOrigin,
  supersededVerdict,
} from "../scripts/resolve-staging-deployment.mjs";

const watchPatterns = (
  JSON.parse(readFileSync(new URL("../railway.app.json", import.meta.url), "utf8")) as {
    build: { watchPatterns: string[] };
  }
).build.watchPatterns;

const deployed = "1111111111111111111111111111111111111111";
const checkout = "2222222222222222222222222222222222222222";

function classify(overrides: Partial<Parameters<typeof classifyStagingDeployment>[0]> = {}) {
  return classifyStagingDeployment({
    deployedSha: deployed,
    checkoutSha: checkout,
    deployedIsAncestor: true,
    changedFiles: [],
    watchPatterns,
    allowEquivalent: true,
    ...overrides,
  });
}

describe("staging deployment resolver (#3113)", () => {
  it("accepts the exact checkout commit in every mode", () => {
    expect(classify({ deployedSha: checkout, allowEquivalent: false }).relation).toBe("exact");
  });

  it("treats documentation, test and workflow changes as app-equivalent on the nightly", () => {
    const result = classify({
      changedFiles: ["docs/outstanding-issues.md", "tests/railway-config.test.ts", ".github/workflows/ci.yml", ""],
    });
    expect(result).toEqual({ relation: "equivalent", waitingFiles: [] });
  });

  it("reports staging as stale when an app input is waiting, naming the files", () => {
    const result = classify({
      changedFiles: ["docs/a.md", "src/app/api/roster/team/route.ts", "package-lock.json"],
    });
    expect(result.relation).toBe("stale");
    expect(result.waitingFiles).toEqual(["src/app/api/roster/team/route.ts", "package-lock.json"]);
  });

  it("honours railway.app.json exclusions, so a snapshot refresh is not an app change", () => {
    expect(classify({ changedFiles: ["data/outstanding-issues-snapshot.json"] }).relation).toBe("equivalent");
    expect(classify({ changedFiles: ["data/mha-timeframes.json"] }).relation).toBe("stale");
  });

  it("keeps a release proof strict: an older commit never stands in for the candidate", () => {
    expect(classify({ allowEquivalent: false, changedFiles: ["docs/a.md"] })).toEqual({
      relation: "stale",
      waitingFiles: [],
    });
  });

  it("refuses a deployed commit that is not on the checkout's history", () => {
    expect(classify({ deployedIsAncestor: false }).relation).toBe("unrelated");
  });

  it("does not fail a run when staging has already moved past the checkout", () => {
    const newer = { deployedIsAncestor: false, deployedIsDescendant: true };
    expect(classify({ ...newer, changedFiles: ["docs/a.md"] }).relation).toBe("equivalent");
    expect(classify({ ...newer, changedFiles: ["src/app/page.tsx"] }).relation).toBe("superseded");
    // A release proof still needs the exact commit.
    expect(classify({ ...newer, allowEquivalent: false, changedFiles: ["docs/a.md"] }).relation).toBe("superseded");
  });

  // Codex P1 on #3748: runs are serialised, so the newer commit's proof cannot have finished when
  // this run meets it. Passing on the gate would let this commit go live with nothing proven.
  it("passes a superseded commit only on the nightly, holds it on the gate and fails a strict proof", () => {
    expect(supersededVerdict({ allowEquivalent: true, supersededOk: true })).toBe("pass");
    expect(supersededVerdict({ allowEquivalent: true, supersededOk: false })).toBe("hold");
    expect(supersededVerdict({ allowEquivalent: false, supersededOk: false })).toBe("fail");
  });

  it("only reads an https staging origin, never the production host", () => {
    expect(parseStagingAppOrigin("https://app-staging.example.test/path")).toBe("https://app-staging.example.test");
    expect(() => parseStagingAppOrigin("http://app-staging.example.test")).toThrow(/https/);
    expect(() => parseStagingAppOrigin("https://psychiatry.tools")).toThrow(/production/);
    expect(() => parseStagingAppOrigin("https://www.psychiatry.tools")).toThrow(/production/);
  });
});
