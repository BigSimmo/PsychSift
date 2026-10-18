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
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const durable = uploadRoute.lastIndexOf("durableAdmission = true;", call);
      expect(durable, "durable admission precedes the release").toBeGreaterThan(-1);
      expect(uploadRoute.slice(durable, call)).not.toContain("catch");
    }
    expect(uploadRoute).toContain("storageUpload.collisionRecovered ? intendedStoragePath : null");
    for (const call of calls.slice(1)) {
      const callArgs = uploadRoute.slice(call, uploadRoute.indexOf("});", call));
      expect(callArgs).toContain("supersededPath: supersededStoragePath,");
      expect(callArgs).toContain("committedPath: admissionStoragePath,");
    }
  });
  it("retries cleanup on a durable replay before returning, using the committed row's path", () => {
    const replay = uploadRoute.slice(
      uploadRoute.indexOf('if (replay.outcome !== "not_found")'),
      uploadRoute.indexOf("const { data: duplicate", uploadRoute.indexOf('if (replay.outcome !== "not_found")')),
    );
    expect(replay).toContain("supersededPath: storagePath");
    expect(replay).toContain("committedPath: committedReplayPath");
    expect(replay).toContain("const committedReplayPath = replay.document.storage_path");
    expect(replay.indexOf("await releaseSupersededUpload")).toBeLessThan(replay.indexOf("return NextResponse.json"));
  });
});
