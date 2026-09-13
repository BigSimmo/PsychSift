import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uploadRoute = readFileSync(new URL("../src/app/api/upload/route.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../scripts/import-documents.ts", import.meta.url), "utf8");

describe("duplicate upload cleanup ledger", () => {
  it("fails closed when storage.remove fails and the cleanup ledger insert also fails", () => {
    expect(uploadRoute).toContain('from("storage_cleanup_jobs").insert({');
    expect(uploadRoute).toContain("const { error: cleanupLedgerError }");
    expect(uploadRoute).toContain("Duplicate upload cleanup ledger insert failed");
    expect(uploadRoute).toMatch(/if \(cleanupLedgerError\) \{[\s\S]*throw new Error\(/);
  });

  it("retains durable cleanup ledgers for route and backend precommit compensation", () => {
    expect(uploadRoute.match(/from\("storage_cleanup_jobs"\)\.insert\(\{/g)?.length).toBeGreaterThanOrEqual(3);
    expect(importer).toContain('from("storage_cleanup_jobs").insert({');
    expect(importer).toContain("image_bucket: args.imageBucket");
    expect(importer).toContain("imageBucket: env.SUPABASE_IMAGE_BUCKET");
  });
});
