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
  candidate_release_id: string;
  operation: "changed" | "unchanged" | "tombstone";
};

type DrainOptions = {
  workerId: string;
  limit: number;
  leaseSeconds: number;
  maxBatchSize: number;
  maxAttempts: number;
  heartbeatEvery?: number;
  heartbeatIntervalMs?: number;
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
      p_attempt_count: event.attempt_count,
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
      let heartbeatLost = false;
      const heartbeatInterval = setInterval(
        () => {
          void options
            .rpc("heartbeat_site_content_sync_event", {
              ...identity,
              p_lease_seconds: options.leaseSeconds,
            })
            .then((result) => {
              if (result.error || (result.data as { ok?: boolean } | null)?.ok === false) heartbeatLost = true;
            })
            .catch(() => {
              heartbeatLost = true;
            });
        },
        Math.max(25, options.heartbeatIntervalMs ?? Math.floor((options.leaseSeconds * 1_000) / 3)),
      );
      let processed: { releaseId?: string };
      try {
        processed = await options.processEvent(event);
      } finally {
        clearInterval(heartbeatInterval);
      }
      if (heartbeatLost) throw new Error("Worker lease heartbeat was lost.");
      if (!processed.releaseId || processed.releaseId !== event.candidate_release_id) {
        throw new Error("Worker completion requires the exact candidate release.");
      }
      const completion = requireRpc(
        await options.rpc("complete_site_content_sync_event", {
          ...identity,
          p_release_id: processed.releaseId,
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

type HandlerDependencies = Pick<DrainOptions, "workerId" | "rpc" | "processEvent" | "log" | "heartbeatIntervalMs"> & {
  authorization: string;
};

export function createSiteContentSyncHandler(dependencies: HandlerDependencies) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (request.headers.get("authorization") !== dependencies.authorization) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const counts = await drainSiteContentSyncBatch({
        ...dependencies,
        limit: 25,
        leaseSeconds: 90,
        maxBatchSize: 25,
        maxAttempts: 4,
      });
      return Response.json(counts);
    } catch {
      return Response.json({ error: "site_content_sync_failed" }, { status: 503 });
    }
  };
}

declare const Deno:
  | undefined
  | {
      env: { get(name: string): string | undefined };
      serve(handler: (request: Request) => Promise<Response>): void;
    };

if (typeof Deno !== "undefined") {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const invocationSecret = Deno.env.get("SITE_CONTENT_SYNC_INVOCATION_SECRET") ?? "";
  const workerId = Deno.env.get("SITE_CONTENT_SYNC_WORKER_ID") ?? "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const embeddingModel = Deno.env.get("RAG_EMBEDDING_MODEL") ?? "text-embedding-3-small";
  const missingConfiguration = [url, serviceKey, invocationSecret, workerId, openAiKey].some(
    (value) => value.trim().length === 0,
  );
  const rpc = async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return response.ok
      ? { data: await response.json(), error: null }
      : { data: null, error: { message: "site-content RPC failed" } };
  };
  Deno.serve(
    missingConfiguration
      ? async () => Response.json({ error: "site_content_sync_not_configured" }, { status: 503 })
      : createSiteContentSyncHandler({
          authorization: `Bearer ${invocationSecret}`,
          workerId,
          rpc,
          processEvent: async (event) => {
            const payload = requireRpc(
              await rpc("read_site_content_sync_event_payload", {
                p_event_id: event.event_id,
                p_worker_id: workerId,
                p_lease_id: event.lease_id,
                p_generation_id: event.generation_id,
                p_attempt_count: event.attempt_count,
              }),
              "Site-content payload read",
            ) as {
              embeddingInput: string;
              candidateReleaseId: string;
              operation: "changed" | "unchanged" | "tombstone";
            };
            if (payload.operation !== "changed") {
              const carried = requireRpc(
                await rpc("stage_site_content_candidate_operation", {
                  p_event_id: event.event_id,
                  p_worker_id: workerId,
                  p_lease_id: event.lease_id,
                  p_generation_id: event.generation_id,
                  p_attempt_count: event.attempt_count,
                  p_candidate_release_id: event.candidate_release_id,
                }),
                "Site-content candidate carry-forward/tombstone staging",
              ) as { releaseId?: string };
              return { releaseId: carried.releaseId };
            }
            const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
              method: "POST",
              headers: { authorization: `Bearer ${openAiKey}`, "content-type": "application/json" },
              body: JSON.stringify({ model: embeddingModel, input: payload.embeddingInput }),
            });
            if (!embeddingResponse.ok) throw new Error("Embedding request failed.");
            const embeddingBody = (await embeddingResponse.json()) as { data?: Array<{ embedding?: number[] }> };
            const embedding = embeddingBody.data?.[0]?.embedding;
            if (!embedding?.length) throw new Error("Embedding response is invalid.");
            const floatBuffer = new ArrayBuffer(embedding.length * Float32Array.BYTES_PER_ELEMENT);
            const floatView = new DataView(floatBuffer);
            embedding.forEach((value, index) =>
              floatView.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, false),
            );
            const floatBytes = new Uint8Array(floatBuffer);
            const byteHash = new Uint8Array(await crypto.subtle.digest("SHA-256", floatBytes));
            const jsonHash = new Uint8Array(
              await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(embedding))),
            );
            const hexadecimal = (bytes: Uint8Array) =>
              [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
            const staged = requireRpc(
              await rpc("stage_site_content_candidate_projection", {
                p_event_id: event.event_id,
                p_worker_id: workerId,
                p_lease_id: event.lease_id,
                p_generation_id: event.generation_id,
                p_attempt_count: event.attempt_count,
                p_candidate_release_id: event.candidate_release_id,
                p_embedding: embedding,
                p_embedding_model: embeddingModel,
                p_embedding_dimensions: embedding.length,
                p_embedding_digest: `sha256:${hexadecimal(jsonHash)}`,
                p_embedding_bytes_digest: `sha256:${hexadecimal(byteHash)}`,
              }),
              "Site-content candidate staging",
            ) as { releaseId?: string };
            return { releaseId: staged.releaseId };
          },
        }),
  );
}
