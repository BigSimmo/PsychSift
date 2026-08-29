import { describe, expect, it } from "vitest";

import { classifyRagFallbackReason, publicFallbackReason } from "@/lib/rag/rag-fallback-reason";

describe("sanitized RAG fallback reasons", () => {
  it("maps provider failures to stable public codes without internals", () => {
    expect(classifyRagFallbackReason({ providerFailure: "timeout" })).toBe("provider_timeout");
    expect(
      classifyRagFallbackReason({
        routingReason: "hybrid_error; generation_fallback:socket ETIMEDOUT secret-host?token=abc",
      }),
    ).toBe("provider_failure");
    expect(publicFallbackReason("provider_failure")).not.toMatch(/socket|host|secret|token|provider/i);
  });

  it("gives typed fields precedence over incompatible legacy text", () => {
    expect(
      classifyRagFallbackReason({
        fallbackReasonCode: "source_conflict",
        providerFailure: "timeout",
        routingReason: "missing_api_key",
      }),
    ).toBe("source_conflict");
    expect(
      classifyRagFallbackReason({
        insufficiencyReason: "site_content_stale",
        routingReason: "quota exceeded",
      }),
    ).toBe("site_content_stale");
  });

  it("maps unknown legacy details to unknown rather than copying sensitive text", () => {
    const secret = "https://private-host.example/path?api_key=secret";
    const code = classifyRagFallbackReason({ routingReason: secret });

    expect(code).toBe("unknown");
    expect(publicFallbackReason(code)).not.toMatch(/private-host|api_key|secret|https/i);
  });
});
