import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

import { withServiceRoleAuthorization } from "./auth.ts";

type ClaimedEvent = {
  event_sequence: number;
  logical_id: string;
  target_publication_id: string;
  target_change_epoch: number;
  attempt_count: number;
  worker_id: string;
  lease_token: string;
  lease_generation: number;
};

// One claim per invocation prevents an unstarted item from aging behind slow
// provider work. Horizontal concurrency is still bounded by the scheduler.
const MAX_BATCH = 1;
const MAX_PLAN_RECORDS = 5000;
const LEASE_SECONDS = 120;

type InvocationPhase = "started" | "succeeded" | "failed";
type InvocationOutcome = null | "idle" | "ready" | "claim_failed" | "event_failed" | "lease_lost" | "worker_failed";

async function recordInvocation(
  supabase: SupabaseClient,
  workerId: string,
  invocationId: string,
  phase: InvocationPhase,
  outcome: InvocationOutcome,
) {
  try {
    const result = await supabase.rpc("record_site_content_sync_worker_invocation", {
      p_worker_id: workerId,
      p_invocation_id: invocationId,
      p_phase: phase,
      p_outcome_code: outcome,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}

function fixedLog(code: string, event: ClaimedEvent, count = 0) {
  console.log(JSON.stringify({ code, eventSequence: event.event_sequence, logicalId: event.logical_id, count }));
}

function requiredEnvironment(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "OPENAI_API_KEY") {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`SITE_CONTENT_CONFIG_MISSING:${name}`);
  return value;
}

type PlanItem = {
  logicalId: string;
  normalizedText: string;
  reuseEmbedding: boolean;
  embedding?: number[];
  tombstone?: boolean;
  [key: string]: unknown;
};

type SyncPlan = {
  version: "site-content-sync-plan-v1";
  releaseId: string;
  planDigest: string;
  releaseDigest: string;
  dynamicStateDigest: string;
  targetChangeEpoch: string;
  generationId: string;
  registryVersion: string;
  staticManifestDigest: string;
  reconciliationPlanDigest: string | null;
  embedding: { model: string; dimensions: number; fingerprint: string };
  added: PlanItem[];
  changed: PlanItem[];
  unchanged: PlanItem[];
  tombstones: PlanItem[];
  counts: { total: number; tombstones: number };
};

function parsePlan(value: unknown): SyncPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SITE_CONTENT_PLAN_INVALID");
  const plan = value as SyncPlan;
  const groups = [plan.added, plan.changed, plan.unchanged, plan.tombstones];
  if (
    plan.version !== "site-content-sync-plan-v1" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(plan.releaseId) ||
    !/^[0-9a-f]{64}$/.test(plan.planDigest) ||
    !/^[0-9a-f]{64}$/.test(plan.releaseDigest) ||
    !groups.every(Array.isArray) ||
    groups.reduce((total, group) => total + group.length, 0) > MAX_PLAN_RECORDS ||
    !plan.embedding?.model ||
    !Number.isInteger(plan.embedding.dimensions) ||
    plan.embedding.dimensions !== 1536
  )
    throw new Error("SITE_CONTENT_PLAN_INVALID");
  return plan;
}

const EMBEDDING_BATCH_SIZE = 256;

async function embedChangedRecords(plan: SyncPlan, records: PlanItem[]) {
  const required = records.filter((record) => !record.tombstone && !record.reuseEmbedding);
  if (required.length === 0) return new Map<string, number[]>();
  const result = new Map<string, number[]>();
  for (let i = 0; i < required.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = required.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredEnvironment("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: plan.embedding.model,
        dimensions: plan.embedding.dimensions,
        input: batch.map((record) => record.normalizedText),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("SITE_CONTENT_PROVIDER_FAILED");
    const payload = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
    if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
      throw new Error("SITE_CONTENT_PROVIDER_INVALID");
    }
    for (const item of payload.data) {
      const source = batch[item.index];
      if (!source || !Array.isArray(item.embedding) || item.embedding.length !== plan.embedding.dimensions) {
        throw new Error("SITE_CONTENT_PROVIDER_INVALID");
      }
      result.set(source.logicalId, item.embedding);
    }
  }
  return result;
}

async function failEvent(
  supabase: SupabaseClient,
  event: ClaimedEvent,
  errorCode: "provider_failure" | "poison_payload" | "staging_failure",
) {
  await supabase.rpc("fail_site_content_sync_event", {
    p_event_sequence: event.event_sequence,
    p_worker_id: event.worker_id,
    p_lease_token: event.lease_token,
    p_lease_generation: event.lease_generation,
    p_error_code: errorCode,
  });
}

async function processEvent(supabase: SupabaseClient, event: ClaimedEvent) {
  const heartbeat = () =>
    supabase.rpc("heartbeat_site_content_sync_event", {
      p_event_sequence: event.event_sequence,
      p_worker_id: event.worker_id,
      p_lease_token: event.lease_token,
      p_lease_generation: event.lease_generation,
      p_lease_seconds: LEASE_SECONDS,
    });
  const initialHeartbeat = await heartbeat();
  if (initialHeartbeat.error || initialHeartbeat.data !== true) {
    fixedLog("SITE_CONTENT_LEASE_LOST", event);
    return "lease_lost" as const;
  }

  // A reviewed deterministic plan is prepared by the source-only planner/CLI.
  // The worker never synthesizes publication content or actor identity. The
  // stage RPC validates epoch, publication ids, lease fencing, and idempotency.
  const planResult = await supabase.rpc("read_site_content_sync_event_plan", {
    p_event_sequence: event.event_sequence,
    p_worker_id: event.worker_id,
    p_lease_token: event.lease_token,
    p_lease_generation: event.lease_generation,
  });
  if (planResult.error || !planResult.data) {
    await failEvent(supabase, event, "poison_payload");
    fixedLog("SITE_CONTENT_PLAN_UNAVAILABLE", event);
    return "failed" as const;
  }

  let plan: SyncPlan;
  let records: PlanItem[];
  try {
    plan = parsePlan(planResult.data);
    records = [...plan.added, ...plan.changed, ...plan.unchanged, ...plan.tombstones];
  } catch {
    await failEvent(supabase, event, "poison_payload");
    fixedLog("SITE_CONTENT_PLAN_INVALID", event);
    return "failed" as const;
  }

  let embeddings: Map<string, number[]>;
  try {
    const providerHeartbeat = await heartbeat();
    if (providerHeartbeat.error || providerHeartbeat.data !== true) {
      fixedLog("SITE_CONTENT_LEASE_LOST", event);
      return "lease_lost" as const;
    }
    let heartbeatFailed = false;
    const providerHeartbeatTimer = setInterval(
      () => {
        void Promise.resolve(heartbeat())
          .then((result) => {
            if (result.error || result.data !== true) heartbeatFailed = true;
          })
          .catch(() => {
            heartbeatFailed = true;
          });
      },
      Math.floor((LEASE_SECONDS * 1000) / 3),
    );
    try {
      embeddings = await embedChangedRecords(plan, records);
    } finally {
      clearInterval(providerHeartbeatTimer);
    }
    if (heartbeatFailed) {
      fixedLog("SITE_CONTENT_LEASE_LOST", event);
      return "lease_lost" as const;
    }
    const stageHeartbeat = await heartbeat();
    if (stageHeartbeat.error || stageHeartbeat.data !== true) {
      fixedLog("SITE_CONTENT_LEASE_LOST", event);
      return "lease_lost" as const;
    }
  } catch {
    await failEvent(supabase, event, "provider_failure");
    fixedLog(
      "SITE_CONTENT_PROVIDER_FAILED",
      event,
      records.filter((record) => !record.tombstone && !record.reuseEmbedding).length,
    );
    return "failed" as const;
  }
  let stagedRecords: PlanItem[];
  try {
    stagedRecords = records.map((record) => {
      const embedding = record.reuseEmbedding ? record.embedding : embeddings.get(record.logicalId);
      if (!record.tombstone && (!embedding || embedding.length !== plan.embedding.dimensions)) {
        throw new Error("SITE_CONTENT_EMBEDDING_MISSING");
      }
      return {
        ...record,
        embeddingModel: plan.embedding.model,
        embeddingDimensions: plan.embedding.dimensions,
        embeddingFingerprint: plan.embedding.fingerprint,
        ...(embedding ? { embedding } : {}),
      };
    });
  } catch {
    await failEvent(supabase, event, "poison_payload");
    fixedLog("SITE_CONTENT_EMBEDDING_INVALID", event);
    return "failed" as const;
  }

  const stage = await supabase.rpc("stage_site_content_sync_event", {
    p_event_sequence: event.event_sequence,
    p_worker_id: event.worker_id,
    p_lease_token: event.lease_token,
    p_lease_generation: event.lease_generation,
    p_stage: {
      ...plan,
      releaseId: plan.releaseId,
      records: stagedRecords,
    },
  });
  if (stage.error || stage.data !== true) {
    await failEvent(supabase, event, "staging_failure");
    fixedLog("SITE_CONTENT_STAGE_REJECTED", event);
    return "failed" as const;
  }
  fixedLog("SITE_CONTENT_EVENT_READY", event, 1);
  return "ready" as const;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  return withServiceRoleAuthorization(request.headers.get("authorization"), async () => {
    try {
      const supabase = createClient(
        requiredEnvironment("SUPABASE_URL"),
        requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "1");
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_BATCH, Math.trunc(requestedLimit))) : 1;
      const workerId = crypto.randomUUID();
      const invocationId = crypto.randomUUID();
      const admitted = await recordInvocation(supabase, workerId, invocationId, "started", null);
      if (!admitted) {
        return Response.json({ ok: false, error: "SITE_CONTENT_WORKER_NOT_ADMITTED" }, { status: 503 });
      }
      try {
        const claim = await supabase.rpc("claim_site_content_sync_events", {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: LEASE_SECONDS,
        });
        if (claim.error) {
          const terminalRecorded = await recordInvocation(supabase, workerId, invocationId, "failed", "claim_failed");
          return Response.json(
            { ok: false, error: terminalRecorded ? "SITE_CONTENT_CLAIM_FAILED" : "SITE_CONTENT_WORKER_FAILED" },
            { status: 500 },
          );
        }
        const events = (claim.data ?? []) as ClaimedEvent[];
        const counts = { ready: 0, failed: 0, leaseLost: 0 };
        for (const event of events) {
          const outcome = await processEvent(supabase, event);
          if (outcome === "ready") counts.ready += 1;
          else if (outcome === "failed") counts.failed += 1;
          else counts.leaseLost += 1;
        }
        const terminalPhase = counts.failed > 0 || counts.leaseLost > 0 ? "failed" : "succeeded";
        const terminalOutcome: InvocationOutcome =
          counts.leaseLost > 0
            ? "lease_lost"
            : counts.failed > 0
              ? "event_failed"
              : counts.ready > 0
                ? "ready"
                : "idle";
        const terminalRecorded = await recordInvocation(
          supabase,
          workerId,
          invocationId,
          terminalPhase,
          terminalOutcome,
        );
        if (!terminalRecorded) {
          return Response.json({ ok: false, error: "SITE_CONTENT_WORKER_FAILED" }, { status: 500 });
        }
        return Response.json({ ok: true, claimed: events.length, ...counts });
      } catch {
        try {
          await recordInvocation(supabase, workerId, invocationId, "failed", "worker_failed");
        } catch {
          // The fixed response is authoritative; the durable unterminated row makes health stop.
        }
        return Response.json({ ok: false, error: "SITE_CONTENT_WORKER_FAILED" }, { status: 500 });
      }
    } catch {
      return Response.json({ ok: false, error: "SITE_CONTENT_WORKER_FAILED" }, { status: 500 });
    }
  });
});
