import { describe, expect, it } from "vitest";

// A controller-owned immutable baseline copy can demonstrate the regression without
// changing the working source under another reviewer or test process.
const { compareDriftSnapshots }: typeof import("../scripts/check-drift") = await import(
  process.env.DATA_DRIFT_BASELINE_MODULE ?? "../scripts/check-drift"
);

const relationIdentity = "relation:ingestion_generation_evidence.retained_artifacts";
const snapshot = (): { private_objects: Array<{ identity: string; state: Record<string, unknown> }> } => ({
  private_objects: [
    {
      identity: relationIdentity,
      state: {
        owner: "postgres",
        acl: ["postgres=arwdDxtm/postgres"],
        rls_enabled: true,
        rls_forced: false,
        triggers: [{ name: "evidence_immutable", enabled: "O", definition: "immutable()" }],
        constraints: [{ name: "bytes_hash", validated: true, definition: "CHECK (hash_matches)" }],
      },
    },
    {
      identity: "function:ingestion_generation_evidence.immutable()",
      state: { owner: "postgres", def_hash: "before", config: ['search_path=""'], acl: [] },
    },
    {
      identity: "default_acl:postgres:ingestion_generation_evidence:f",
      state: { acl: ["postgres=X/postgres"] },
    },
  ],
});

describe("application-owned private schema drift", () => {
  it("keeps public-only snapshot compatibility while both sides lack the private inventory", () => {
    expect(compareDriftSnapshots({}, {}, []).findings).toEqual([]);
  });

  it("fails closed when an older live probe omits the expected private inventory", () => {
    const result = compareDriftSnapshots(snapshot(), {}, []);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f) => f.category === "private_objects" && f.kind === "missing_live")).toBe(true);
  });

  it.each([
    ["owner", "other_owner"],
    ["acl", ["authenticated=r/postgres"]],
    ["rls_enabled", false],
    ["rls_forced", true],
    ["triggers", [{ name: "evidence_immutable", enabled: "D", definition: "immutable()" }]],
    ["constraints", [{ name: "bytes_hash", validated: false, definition: "CHECK (hash_matches)" }]],
  ])("detects a private-only %s change", (field, value) => {
    const live = snapshot();
    Object.assign(live.private_objects[0].state, { [String(field)]: value });
    expect(compareDriftSnapshots(snapshot(), live, []).findings).toEqual([
      expect.objectContaining({ category: "private_objects", kind: "mismatch", key: relationIdentity }),
    ]);
  });

  it.each(["def_hash", "config", "acl"])("detects private function %s drift", (field) => {
    const live = snapshot();
    Object.assign(live.private_objects[1].state, { [field]: field === "def_hash" ? "after" : ["changed"] });
    expect(compareDriftSnapshots(snapshot(), live, []).findings).toEqual([
      expect.objectContaining({ kind: "mismatch", key: "function:ingestion_generation_evidence.immutable()" }),
    ]);
  });

  it("compares schema-scoped default privileges and schema-qualified additions", () => {
    const live = snapshot();
    Object.assign(live.private_objects[2].state, { acl: ["authenticated=X/postgres"] });
    live.private_objects.push({ identity: "relation:ingestion_generation_evidence.unexpected", state: {} });
    const result = compareDriftSnapshots(snapshot(), live, []);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "mismatch", key: "default_acl:postgres:ingestion_generation_evidence:f" }),
      expect.objectContaining({ kind: "unexpected_live", key: "relation:ingestion_generation_evidence.unexpected" }),
    ]);
    expect(result.allowed).toEqual([]);
  });
});
