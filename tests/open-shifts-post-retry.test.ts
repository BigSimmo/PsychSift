import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { forgetPostKey, postKeyFor } from "@/components/open-shifts/open-shifts-post-keys";

describe("R21: Open shifts postKey idempotency and retry contract", () => {
  it("preserves the same postKey across retries until forgetPostKey is called", () => {
    const memory: Record<string, string> = {};
    const signature = 'actor-1|["service-1","2026-10-08","08:00","16:30","D","day","","registrar",false]';

    const firstKey = postKeyFor(signature, memory, 1_000);
    const retryKey = postKeyFor(signature, memory, 2_000);
    expect(retryKey).toBe(firstKey);

    forgetPostKey(signature, memory, 3_000);
    const freshKey = postKeyFor(signature, memory, 4_000);
    expect(freshKey).not.toBe(firstKey);
  });

  it("ensures OpenShiftsPostPage uses server postKey idempotency instead of client similarity matching and checks replayed status", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/open-shifts/open-shifts-post-page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("lostAnswerMatch");
    expect(source).toContain("postKeyFor(keyFor(on, postingActorId), postKeys.current)");
    expect(source).toContain("That earlier post is no longer open. Try posting again.");
  });
});
