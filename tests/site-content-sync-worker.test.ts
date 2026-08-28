import { describe, expect, it, vi } from "vitest";

import { createSiteContentSyncHandler, drainSiteContentSyncBatch } from "../supabase/functions/site-content-sync/index";

describe("site-content sync worker", () => {
  it("records started before claiming and succeeded for an idle invocation", async () => {
    const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) =>
      name === "claim_site_content_sync_events" ? { data: [], error: null } : { data: { ok: true }, error: null },
    );
    const handler = createSiteContentSyncHandler({
      invocationSecret: "synthetic-secret",
      workerId: "66666666-6666-4666-8666-666666666666",
      invocationId: () => "77777777-7777-4777-8777-777777777777",
      rpc,
      processEvent: vi.fn(),
    });

    const response = await handler(
      new Request("http://local", { method: "POST", headers: { authorization: "Bearer synthetic-secret" } }),
    );

    expect(response.status).toBe(200);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "record_site_content_synchronizer_heartbeat",
      "claim_site_content_sync_events",
      "record_site_content_synchronizer_heartbeat",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_phase: "started" });
    expect(rpc.mock.calls[2]?.[1]).toMatchObject({ p_phase: "succeeded" });
  });

  it("stops before claim when synchronizer telemetry cannot be established", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: false }, error: null }));
    const handler = createSiteContentSyncHandler({
      invocationSecret: "synthetic-secret",
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc,
      processEvent: vi.fn(),
    });

    const response = await handler(
      new Request("http://local", { method: "POST", headers: { authorization: "Bearer synthetic-secret" } }),
    );
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("claim_site_content_sync_events", expect.anything());
  });

  it("records failed when an established invocation cannot claim work", async () => {
    const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) =>
      name === "claim_site_content_sync_events"
        ? { data: null, error: { message: "synthetic unavailable" } }
        : { data: { ok: true }, error: null },
    );
    const handler = createSiteContentSyncHandler({
      invocationSecret: "synthetic-secret",
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc,
      processEvent: vi.fn(),
    });

    const response = await handler(
      new Request("http://local", { method: "POST", headers: { authorization: "Bearer synthetic-secret" } }),
    );
    expect(response.status).toBe(503);
    expect(
      rpc.mock.calls
        .filter(([name]) => name === "record_site_content_synchronizer_heartbeat")
        .map(([, args]) => (args as { p_phase: string }).p_phase),
    ).toEqual(["started", "failed"]);
  });

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
              candidate_release_id: "55555555-5555-4555-8555-555555555555",
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
              candidate_release_id: "55555555-5555-4555-8555-555555555555",
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

  it("authenticates the concrete handler and heartbeats periodically during slow work", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(async (name: string) =>
      name === "claim_site_content_sync_events"
        ? {
            data: [
              {
                event_id: "11111111-1111-4111-8111-111111111111",
                publication_id: "22222222-2222-4222-8222-222222222222",
                logical_id: "medication:alpha",
                content_hash: `sha256:${"a".repeat(64)}`,
                attempt_count: 1,
                lease_id: "33333333-3333-4333-8333-333333333333",
                generation_id: "44444444-4444-4444-8444-444444444444",
                lease_expires_at: "2099-08-24T01:05:00.000Z",
                candidate_release_id: "55555555-5555-4555-8555-555555555555",
              },
            ],
            error: null,
          }
        : { data: { ok: true }, error: null },
    );
    const handler = createSiteContentSyncHandler({
      invocationSecret: "synthetic-secret",
      workerId: "66666666-6666-4666-8666-666666666666",
      rpc,
      processEvent: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { releaseId: event.candidate_release_id };
      },
      heartbeatIntervalMs: 50,
    });
    expect((await handler(new Request("http://local", { method: "POST" }))).status).toBe(401);
    const responsePromise = handler(
      new Request("http://local", { method: "POST", headers: { authorization: "Bearer synthetic-secret" } }),
    );
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_site_content_sync_events", expect.anything()));
    await vi.advanceTimersByTimeAsync(260);
    expect((await responsePromise).status).toBe(200);
    expect(rpc.mock.calls.filter(([name]) => name === "heartbeat_site_content_sync_event").length).toBeGreaterThan(1);
    vi.useRealTimers();
  });

  it("requires an exact non-null candidate release before completion", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "claim_site_content_sync_events"
        ? {
            data: [
              {
                event_id: "11111111-1111-4111-8111-111111111111",
                publication_id: "22222222-2222-4222-8222-222222222222",
                logical_id: "medication:alpha",
                content_hash: `sha256:${"a".repeat(64)}`,
                attempt_count: 1,
                lease_id: "33333333-3333-4333-8333-333333333333",
                generation_id: "44444444-4444-4444-8444-444444444444",
                lease_expires_at: "2099-08-24T01:05:00.000Z",
                candidate_release_id: "55555555-5555-4555-8555-555555555555",
              },
            ],
            error: null,
          }
        : { data: { ok: true }, error: null },
    );
    await drainSiteContentSyncBatch({
      workerId: "66666666-6666-4666-8666-666666666666",
      limit: 1,
      leaseSeconds: 90,
      maxBatchSize: 25,
      maxAttempts: 4,
      rpc,
      processEvent: async () => ({}),
    });
    expect(rpc).not.toHaveBeenCalledWith("complete_site_content_sync_event", expect.anything());
    expect(rpc).toHaveBeenCalledWith(
      "fail_site_content_sync_event",
      expect.objectContaining({ p_error_code: "sync_failed" }),
    );
  });
});
