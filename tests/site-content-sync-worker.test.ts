import { describe, expect, it, vi } from "vitest";

import { drainSiteContentSyncBatch } from "../supabase/functions/site-content-sync/index";

describe("site-content sync worker", () => {
  it("claims a bounded batch and completes only with the live lease and generation identity", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_site_content_sync_events") {
        return {
          data: [
            {
              event_id: "11111111-1111-4111-8111-111111111111",
              publication_id: "22222222-2222-4222-8222-222222222222",
              logical_id: "medication:alpha",
              content_hash: `sha256:${"a".repeat(64)}`,
              attempt_count: 1,
              lease_id: "33333333-3333-4333-8333-333333333333",
              generation_id: "44444444-4444-4444-8444-444444444444",
              lease_expires_at: "2026-08-24T01:05:00.000Z",
            },
          ],
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    });
    const processEvent = vi.fn(async () => ({ releaseId: "55555555-5555-4555-8555-555555555555" }));

    const result = await drainSiteContentSyncBatch({
      workerId: "66666666-6666-4666-8666-666666666666",
      limit: 500,
      leaseSeconds: 90,
      maxBatchSize: 25,
      maxAttempts: 4,
      rpc,
      processEvent,
      heartbeatEvery: 1,
      log: vi.fn(),
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_site_content_sync_events",
      expect.objectContaining({ p_limit: 25, p_lease_seconds: 90 }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "heartbeat_site_content_sync_event",
      expect.objectContaining({
        p_event_id: "11111111-1111-4111-8111-111111111111",
        p_lease_id: "33333333-3333-4333-8333-333333333333",
        p_generation_id: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_site_content_sync_event",
      expect.objectContaining({
        p_event_id: "11111111-1111-4111-8111-111111111111",
        p_lease_id: "33333333-3333-4333-8333-333333333333",
        p_generation_id: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(processEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, quarantined: 0, leaseLost: 0 });
  });

  it("retries and quarantines poison events without logging content or actor identity", async () => {
    const log = vi.fn();
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_site_content_sync_events") {
        return {
          data: [
            {
              event_id: "11111111-1111-4111-8111-111111111111",
              publication_id: "22222222-2222-4222-8222-222222222222",
              logical_id: "medication:alpha",
              content_hash: `sha256:${"a".repeat(64)}`,
              attempt_count: 4,
              lease_id: "33333333-3333-4333-8333-333333333333",
              generation_id: "44444444-4444-4444-8444-444444444444",
              lease_expires_at: "2026-08-24T01:05:00.000Z",
            },
          ],
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    });

    const result = await drainSiteContentSyncBatch({
      workerId: "66666666-6666-4666-8666-666666666666",
      limit: 1,
      leaseSeconds: 90,
      maxBatchSize: 25,
      maxAttempts: 4,
      rpc,
      processEvent: vi.fn(async () => {
        throw new Error("synthetic provider failure containing private body text");
      }),
      log,
    });

    expect(rpc).toHaveBeenCalledWith(
      "fail_site_content_sync_event",
      expect.objectContaining({ p_quarantine: true, p_error_code: "sync_failed" }),
    );
    expect(result.quarantined).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private body text");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/actor|user/i);
  });
});
