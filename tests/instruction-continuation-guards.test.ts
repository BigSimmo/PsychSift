import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROOT_SCRIPT_REF_DOCS,
  extractScriptRefs,
  findStaleRefs,
  parsePackageScripts,
} from "../scripts/check-docs-script-refs.mjs";
import {
  RESERVED_HOSTED_ROLE,
  isGuardedMigrationRolePath,
  validateMigrationRoleEntries,
} from "../scripts/check-hosted-migration-role.mjs";
import { phoneChromePlan } from "../scripts/phone-chrome-plan.mjs";
import { protectedPath } from "../scripts/pr-batch-core.mjs";

// PROJECT-INSTRUCTIONS-CONTINUATION.md holds binding policy split out of AGENTS.md.
// Every guard that covers AGENTS.md must cover the continuation the same way.
const CONTINUATION = "PROJECT-INSTRUCTIONS-CONTINUATION.md";

describe("instruction continuation guard parity", () => {
  it("keeps a continuation-only PR out of unattended batch processing", () => {
    expect(protectedPath("AGENTS.md")).toBe(true);
    expect(protectedPath(CONTINUATION)).toBe(true);
  });

  it("fails the hosted-role check when the continuation names the reserved role", () => {
    expect(isGuardedMigrationRolePath(CONTINUATION)).toBe(true);
    const failures = validateMigrationRoleEntries(
      [{ path: CONTINUATION, content: Buffer.from(`Grant to ${RESERVED_HOSTED_ROLE}.\n`) }],
      { requireHistorical: false },
    );
    expect(failures).toEqual([expect.stringContaining(CONTINUATION)]);
  });

  it("plans the same docs-only phone-chrome stages for the continuation as for AGENTS.md", () => {
    const ids = (files: string[]) => phoneChromePlan(files).stages.map((stage: { id: string }) => stage.id);
    expect(ids([CONTINUATION])).toEqual(ids(["AGENTS.md"]));
  });

  it("scans the continuation for stale npm script references", () => {
    expect(ROOT_SCRIPT_REF_DOCS).toContain(CONTINUATION);
    expect(findStaleRefs(extractScriptRefs("Run `npm run no-such-script-xyz`."), new Set(["build"]))).toEqual([
      "no-such-script-xyz",
    ]);
    const scripts = parsePackageScripts(readFileSync("package.json", "utf8"));
    expect(findStaleRefs(extractScriptRefs(readFileSync(CONTINUATION, "utf8")), scripts)).toEqual([]);
  });

  it("places the continuation in the Knowledge area of the organisation map", () => {
    const knowledge = JSON.parse(readFileSync("docs/organisation/systems/knowledge.json", "utf8"));
    expect(knowledge.paths).toContain(CONTINUATION);
  });
});
