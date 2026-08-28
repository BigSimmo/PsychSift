import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createSiteContentSyncHandler,
  isSiteContentSyncRuntimeConfigurationMissing,
} from "../supabase/functions/site-content-sync/index";

const root = resolve(import.meta.dirname, "..");
const invocationSecret = "synthetic-site-content-invocation-secret-0001";

function runtimeConfiguration(secret: string, serviceKey = "synthetic-service-role-key-000000000001") {
  return {
    url: "https://synthetic.supabase.invalid",
    serviceKey,
    invocationSecret: secret,
    workerId: "66666666-6666-4666-8666-666666666666",
    openAiKey: "synthetic-openai-key",
  };
}

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
      invocationSecret,
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc,
      processEvent: vi.fn(),
    });
    for (const authorization of [
      "Bearer service-role-looking.jwt.value",
      "Bearer wrong-custom-invocation-secret",
      `Bearer  ${invocationSecret}`,
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
        headers: { authorization: `Bearer ${invocationSecret}` },
      }),
    );
    expect(accepted.status).toBe(200);
  });

  it("fails closed at handler construction for weak or untrimmed invocation secrets", () => {
    const dependencies = {
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc: vi.fn(async () => ({ data: { ok: true }, error: null })),
      processEvent: vi.fn(),
    };
    expect(() => createSiteContentSyncHandler({ ...dependencies, invocationSecret: "too-short" })).toThrow(
      /trimmed and at least 32 characters/,
    );
    expect(() => createSiteContentSyncHandler({ ...dependencies, invocationSecret: ` ${invocationSecret} ` })).toThrow(
      /trimmed and at least 32 characters/,
    );
  });

  it("treats weak or service-role-equal production secrets as missing configuration", () => {
    expect(isSiteContentSyncRuntimeConfigurationMissing(runtimeConfiguration("too-short"))).toBe(true);
    const serviceKey = "synthetic-service-role-key-000000000001";
    expect(isSiteContentSyncRuntimeConfigurationMissing(runtimeConfiguration(serviceKey, serviceKey))).toBe(true);
    expect(isSiteContentSyncRuntimeConfigurationMissing(runtimeConfiguration(invocationSecret, serviceKey))).toBe(
      false,
    );
  });
});
