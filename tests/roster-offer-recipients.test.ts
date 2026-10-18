import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { offerRecipients } from "@/lib/roster/alerts/offer-recipients";
function clientResult(data: unknown, error: unknown) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error }) };
  return { from: () => q } as unknown as Parameters<typeof offerRecipients>[0];
}
describe("durable opening lookup", () => {
  it("throws a transient database error instead of treating the opening as absent", async () => {
    await expect(
      offerRecipients(clientResult(null, { message: "temporary" }), "actor", "team", "opening"),
    ).rejects.toThrow("Opening check unavailable");
  });
  it("treats an authoritative missing opening as no recipients", async () => {
    await expect(offerRecipients(clientResult(null, null), "actor", "team", "opening")).resolves.toEqual([]);
  });
  it("skips a closed opening without reusing historical eligibility", async () => {
    await expect(
      offerRecipients(
        clientResult({ status: "cancelled", starts_at: "2026-12-01T00:00:00Z" }, null),
        "actor",
        "team",
        "opening",
      ),
    ).resolves.toEqual([]);
  });
});
