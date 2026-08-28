import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createSiteContentSyncHandler } from "../supabase/functions/site-content-sync/index";

const root = resolve(import.meta.dirname, "..");

describe("site-content synchronizer invocation authentication", () => {
  it("keeps the gateway JWT verifier disabled for the custom bearer-secret contract", () => {
    const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.site-content-sync\]\s+verify_jwt = false/);
  });

  it("uses a fixed-work digest comparison and does not couple invocation auth to the service-role JWT", () => {
    const source = readFileSync(resolve(root, "supabase/functions/site-content-sync/index.ts"), "utf8");
    expect(source).toMatch(/timingSafeSecretMatches[\s\S]*crypto\.subtle\.digest\("SHA-256"/);
    expect(source).not.toMatch(/invocationSecret\s*:\s*serviceKey/);
  });

  it("accepts only the exact custom bearer secret", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "claim_site_content_sync_events" ? { data: [], error: null } : { data: { ok: true }, error: null },
    );
    const handler = createSiteContentSyncHandler({
      invocationSecret: "random-custom-invocation-secret-0001",
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc,
      processEvent: vi.fn(),
    });
    for (const authorization of [
      "Bearer service-role-looking.jwt.value",
      "Bearer wrong-custom-invocation-secret",
      "Bearer  random-custom-invocation-secret-0001",
      "",
    ]) {
      const response = await handler(
        new Request("http://local", { method: "POST", headers: authorization ? { authorization } : {} }),
      );
      expect(response.status).toBe(401);
    }
    expect(rpc).not.toHaveBeenCalled();
    const accepted = await handler(
      new Request("http://local", {
        method: "POST",
        headers: { authorization: "Bearer random-custom-invocation-secret-0001" },
      }),
    );
    expect(accepted.status).toBe(200);
  });
});
