type RpcResult = { data: unknown; error: { message: string } | null };

type ClaimedEvent = {
  event_id: string;
  publication_id: string;
  logical_id: string;
  content_hash: string;
  attempt_count: number;
  lease_id: string;
  generation_id: string;
  lease_expires_at: string;
};

type DrainOptions = {
  workerId: string;
  limit: number;
  leaseSeconds: number;
  maxBatchSize: number;
  maxAttempts: number;
  heartbeatEvery?: number;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  processEvent: (event: ClaimedEvent) => Promise<{ releaseId?: string }>;
  log?: (event: Record<string, unknown>) => void;
};

function requireRpc(result: RpcResult, label: string) {
  if (result.error) throw new Error(`${label} failed.`);
  return result.data;
}

export async function drainSiteContentSyncBatch(options: DrainOptions) {
  const limit = Math.max(1, Math.min(Math.floor(options.limit), options.maxBatchSize));
  const claimed = requireRpc(
    await options.rpc("claim_site_content_sync_events", {
      p_worker_id: options.workerId,
      p_limit: limit,
      p_lease_seconds: options.leaseSeconds,
    }),
    "Site-content claim",
  ) as ClaimedEvent[];
  const counts = { claimed: claimed.length, completed: 0, retried: 0, quarantined: 0, leaseLost: 0 };
  const heartbeatEvery = Math.max(1, options.heartbeatEvery ?? 10);
  for (let index = 0; index < claimed.length; index += 1) {
    const event = claimed[index]!;
    const identity = {
      p_event_id: event.event_id,
      p_worker_id: options.workerId,
      p_lease_id: event.lease_id,
      p_generation_id: event.generation_id,
    };
    try {
      if (index % heartbeatEvery === 0) {
        const heartbeat = requireRpc(
          await options.rpc("heartbeat_site_content_sync_event", {
            ...identity,
            p_lease_seconds: options.leaseSeconds,
          }),
          "Site-content heartbeat",
        ) as { ok?: boolean } | null;
        if (heartbeat?.ok === false) {
          counts.leaseLost += 1;
          continue;
        }
      }
      const processed = await options.processEvent(event);
      const completion = requireRpc(
        await options.rpc("complete_site_content_sync_event", {
          ...identity,
          p_release_id: processed.releaseId ?? null,
          p_expected_content_hash: event.content_hash,
        }),
        "Site-content completion",
      ) as { ok?: boolean } | null;
      if (completion?.ok === false) counts.leaseLost += 1;
      else counts.completed += 1;
    } catch {
      const quarantine = event.attempt_count >= options.maxAttempts;
      const failure = requireRpc(
        await options.rpc("fail_site_content_sync_event", {
          ...identity,
          p_error_code: "sync_failed",
          p_quarantine: quarantine,
          p_retry_after_seconds: quarantine ? null : Math.min(900, 2 ** event.attempt_count * 15),
        }),
        "Site-content failure",
      ) as { ok?: boolean } | null;
      if (failure?.ok === false) counts.leaseLost += 1;
      else if (quarantine) counts.quarantined += 1;
      else counts.retried += 1;
      options.log?.({
        eventId: event.event_id,
        attempt: event.attempt_count,
        outcome: quarantine ? "quarantined" : "retry",
      });
    }
  }
  options.log?.({ workerId: options.workerId, ...counts });
  return counts;
}

// Deployment/invocation is a separate operator decision. This source-only task
// deliberately exports the bounded drain without starting a local or hosted worker.
