import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSiteContentSyncHttpTransport, runSiteContentSyncCli } from "../scripts/sync-site-content-corpus";

describe("site-content operator CLI", () => {
  it("runs the literal P03 provider-free dry-run without an ad-hoc state file", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const plan = await runSiteContentSyncCli([
      "--manifest",
      resolve("tests/fixtures/site-content-sync-manifest.json"),
      "--dry-run",
    ]);
    expect(plan).toMatchObject({ mode: "dry-run", expectedCounts: { desired: 0 } });
    expect(write).toHaveBeenCalled();
  });

  it("provides a guarded built-in transport without placing the validation secret in requests", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
    const send = createSiteContentSyncHttpTransport({
      endpoint: "https://operator.invalid/api/admin/site-content/publish",
      accessToken: "synthetic-admin-access-token",
      fetch,
    });
    await send({ path: "/api/admin/site-content/publish", body: { action: "provision-secret" } });
    expect(fetch).toHaveBeenCalledWith(
      "https://operator.invalid/api/admin/site-content/publish",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer synthetic-admin-access-token" }),
      }),
    );
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("SITE_CONTENT_RECOVERY_VALIDATION_SECRET");
  });
});
