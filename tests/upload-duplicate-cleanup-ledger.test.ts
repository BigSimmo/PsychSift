import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uploadRoute = readFileSync(new URL("../src/app/api/upload/route.ts", import.meta.url), "utf8");

describe("duplicate upload cleanup ledger", () => {
  it("fails closed when storage.remove fails and the cleanup ledger insert also fails", () => {
    expect(uploadRoute).toContain('from("storage_cleanup_jobs").insert({');
    expect(uploadRoute).toContain("const { error: cleanupLedgerError }");
    expect(uploadRoute).toContain("Duplicate upload cleanup ledger insert failed");
    expect(uploadRoute).toMatch(/if \(cleanupLedgerError\) \{[\s\S]*throw new Error\(/);
  });
});

describe("superseded collision object cleanup", () => {
  it("releases the collided intended-path object only after this request's admission is durable", () => {
    const calls = [...uploadRoute.matchAll(/await releaseSupersededUpload\(/g)].map((match) => match.index ?? -1);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const durable = uploadRoute.lastIndexOf("durableAdmission = true;", call);
      expect(durable, "durable admission precedes the release").toBeGreaterThan(-1);
      expect(uploadRoute.slice(durable, call)).not.toContain("catch");
    }
    expect(uploadRoute).toContain("storageUpload.collisionRecovered ? intendedStoragePath : null");
  });
});
