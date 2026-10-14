// Offline candidate for ONE finite, text-only Answer pilot. No SDK import or network call.
// The caller supplies its current remaining balance, verified worst-case rates, and transport.
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ownKeysOnly = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const responseKeys = new Set([
  "model",
  "input",
  "instructions",
  "max_output_tokens",
  "store",
  "service_tier",
  "prompt_cache_key",
  "prompt_cache_options",
  "prompt_cache_retention",
  "safety_identifier",
  "metadata",
  "reasoning",
  "text",
]);
const embeddingKeys = new Set(["model", "input", "dimensions", "encoding_format"]);

export class WireBudgetDenied extends Error {
  constructor(code) {
    super(code);
    this.name = "WireBudgetDenied";
    this.code = code;
  }
}

function deny(code) {
  throw new WireBudgetDenied(code);
}

function usdToMicroFloor(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?$/.test(value)) deny("invalid_remaining_usd");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1000000n + BigInt((fraction + "000000").slice(0, 6));
  if (micros <= 0n) deny("nonpositive_remaining_usd");
  return micros;
}

function rate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1000000) {
    deny("invalid_verified_rate");
  }
  return value;
}

function snapshotPriceTable(prices) {
  if (!isRecord(prices) || Object.keys(prices).length === 0) deny("missing_verified_price_table");
  const snapshot = Object.create(null);
  for (const [model, entry] of Object.entries(prices)) {
    if (!model || !isRecord(entry)) deny("invalid_verified_price_table");
    // Read each caller-owned property once, then validate and retain only private scalars.
    const copy = {
      endpoint: entry.endpoint,
      worstInputUsdPerMillion: entry.worstInputUsdPerMillion,
      worstOutputUsdPerMillion: entry.worstOutputUsdPerMillion,
      maxOutputTokens: entry.maxOutputTokens,
      maxContextTokens: entry.maxContextTokens,
    };
    if (!["responses", "embeddings"].includes(copy.endpoint)) {
      deny("invalid_verified_price_table");
    }
    rate(copy.worstInputUsdPerMillion);
    if (!Number.isSafeInteger(copy.maxContextTokens) || copy.maxContextTokens <= 0) deny("invalid_context_cap");
    if (copy.endpoint === "responses") {
      rate(copy.worstOutputUsdPerMillion);
      if (!Number.isSafeInteger(copy.maxOutputTokens) || copy.maxOutputTokens <= 0) deny("invalid_output_cap");
    }
    snapshot[model] = Object.freeze(copy);
  }
  return Object.freeze(snapshot);
}

function headersContainJson(headers) {
  try {
    const value = new Headers(headers).get("content-type");
    return /^application\/json(?:\s*;|$)/i.test(value ?? "");
  } catch {
    return false;
  }
}

function validateTextInput(input) {
  if (typeof input === "string") return;
  if (!Array.isArray(input) || input.length === 0) deny("unsupported_response_input");
  for (const message of input) {
    if (
      !isRecord(message) ||
      !ownKeysOnly(message, new Set(["role", "content"])) ||
      message.role !== "user" ||
      !Array.isArray(message.content) ||
      message.content.length === 0
    ) {
      deny("unsupported_response_input");
    }
    for (const item of message.content) {
      if (
        !isRecord(item) ||
        !ownKeysOnly(item, new Set(["type", "text"])) ||
        item.type !== "input_text" ||
        typeof item.text !== "string"
      ) {
        deny("nontext_response_input");
      }
    }
  }
}

function validateBody(endpoint, body, prices) {
  if (!isRecord(body) || typeof body.model !== "string") deny("unsupported_json_body");
  const price = prices[body.model];
  if (!price || price.endpoint !== endpoint) deny("unpriced_or_wrong_endpoint_model");
  if (endpoint === "responses") {
    if (
      !ownKeysOnly(body, responseKeys) ||
      typeof body.instructions !== "string" ||
      !Number.isSafeInteger(body.max_output_tokens) ||
      body.max_output_tokens <= 0 ||
      body.max_output_tokens > price.maxOutputTokens ||
      body.store !== false ||
      body.service_tier !== "default"
    )
      deny("unsupported_response_body");
    validateTextInput(body.input);
    if (
      body.text !== undefined &&
      (!isRecord(body.text) ||
        !ownKeysOnly(body.text, new Set(["format", "verbosity"])) ||
        (body.text.format !== undefined && (!isRecord(body.text.format) || body.text.format.type !== "json_schema")))
    ) {
      deny("unsupported_text_format");
    }
  } else {
    if (
      !ownKeysOnly(body, embeddingKeys) ||
      !Array.isArray(body.input) ||
      body.input.length !== 1 ||
      typeof body.input[0] !== "string" ||
      (body.dimensions !== undefined && (!Number.isSafeInteger(body.dimensions) || body.dimensions <= 0))
    ) {
      deny("unsupported_embedding_body");
    }
  }
  return price;
}

// Content-free finite-pilot witness values. Never retain arbitrary exception text.
const refusalStages = new Set(["seed", "prepared", "serialized_wire", "cost", "reservation", "dispatch"]);
const helperRefusalReasons = new Set([
  "accessor_refused",
  "array_refused",
  "object_refused",
  "prototype_key_refused",
  "scalar_refused",
  "string_refused",
  "identity_metadata_changed",
  "location_changed",
  "source_metadata_changed",
  "section_changed",
  "adjacent_context_unapproved",
  "similarity_refused",
  "unapproved_evidence_channel",
  "memory_card_refused",
  "memory_card_changed",
  "duplicate_card",
  "governance_changed",
  "endorsement_changed",
  "quality_issues_changed",
  "source_refused",
  "source_changed",
  "source_hash_changed",
  "source_empty",
  "schema_bound",
  "generation_identity_refused",
  "generation_proof_missing",
  "generation_options_changed",
  "generation_binding_changed",
]);
const wireRefusalReasons = new Set([
  "unsupported_request_target",
  "unsupported_transport_request",
  "invalid_json_body",
  "unsupported_json_body",
  "unpriced_or_wrong_endpoint_model",
  "unsupported_response_body",
  "unsupported_response_input",
  "nontext_response_input",
  "unsupported_text_format",
  "unsupported_embedding_body",
  "pilot_wire_size_exceeded",
  "generation_proof_refused",
  "input_allowance_overflow",
  "cost_allowance_overflow",
  "nonpositive_cost_allowance",
  "cumulative_budget_exceeded",
  "reservation_commit_failed",
  "transport_aborted_before_dispatch",
]);
function refusalReason(error, key, allowed) {
  try {
    if (!error || (typeof error !== "object" && typeof error !== "function")) return "unknown";
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" && allowed.has(descriptor.value)
      ? descriptor.value
      : "unknown";
  } catch {
    return "unknown";
  }
}

/** Every accepted fetch call consumes an irrevocable reservation before forwarding. */
export function createWireBudgetGuard({
  dispatch,
  remainingUsd,
  prices,
  verifiedPriceTableRef,
  expectedOrigin,
  maxSerializedJsonBytes,
  onReserve = () => {},
  admitResponse = () => true,
}) {
  if (typeof dispatch !== "function" || typeof onReserve !== "function" || typeof admitResponse !== "function")
    deny("invalid_guard_callbacks");
  if (typeof verifiedPriceTableRef !== "string" || !verifiedPriceTableRef.trim()) deny("unverified_price_table");
  if (!Number.isSafeInteger(maxSerializedJsonBytes) || maxSerializedJsonBytes <= 0) deny("missing_wire_size_cap");
  const verifiedPrices = snapshotPriceTable(prices);
  const budgetMicroUsd = usdToMicroFloor(remainingUsd);
  let reservedMicroUsd = 0n;
  let attempts = 0;
  let denial = null;
  let firstRefusal = null;
  const reservationAttempts = { embeddings: 0, responses: 0 };
  const dispatchAttempts = { embeddings: 0, responses: 0 };
  let counterState = "exact";
  const increment = (counts, endpoint) => {
    if (counts[endpoint] < 65535) counts[endpoint] += 1;
    else counterState = "saturated";
  };
  const latchRefusal = (stage, reason) => {
    firstRefusal ??= Object.freeze({ stage: refusalStages.has(stage) ? stage : "unknown", reason });
  };
  let reservationWriteTail = Promise.resolve();
  const origin = new URL(expectedOrigin);
  if (origin.href !== "https://api.openai.com/") {
    deny("invalid_expected_origin");
  }

  const fetch = async (input, init) => {
    if (denial) throw denial; // SDK may retry a failed fetch; keep refusal sticky.
    let refusalStage = "serialized_wire";
    try {
      if (typeof input !== "string" && !(input instanceof URL)) deny("unsupported_request_target");
      // Snapshot every dispatch-significant field before validation or an awaited ledger write.
      // The signal stays live so a later abort still cancels the actual transport.
      const dispatchInput = new URL(input).href;
      const dispatchInit = { ...init };
      try {
        dispatchInit.headers = new Headers(dispatchInit.headers);
      } catch {
        deny("unsupported_transport_request");
      }
      const target = new URL(dispatchInput);
      if (
        target.origin !== origin.origin ||
        target.search ||
        target.hash ||
        !["/v1/responses", "/v1/embeddings"].includes(target.pathname) ||
        dispatchInit.method !== "POST" ||
        !headersContainJson(dispatchInit.headers) ||
        typeof dispatchInit.body !== "string" ||
        dispatchInit.signal?.aborted
      ) {
        deny("unsupported_transport_request");
      }
      const endpoint = target.pathname === "/v1/responses" ? "responses" : "embeddings";
      let body;
      try {
        body = JSON.parse(dispatchInit.body);
      } catch {
        deny("invalid_json_body");
      }
      const price = validateBody(endpoint, body, verifiedPrices);
      // The published model context is a conservative charged-input allowance for
      // a context-admitted request, including any hidden role/schema token overhead.
      // The separate pilot wire cap rejects unexpectedly large serialized requests.
      const wireBytes = Buffer.byteLength(dispatchInit.body, "utf8");
      if (wireBytes > maxSerializedJsonBytes) deny("pilot_wire_size_exceeded");
      // The admission callback receives only the immutable serialized snapshot;
      // it cannot mutate the private body/price values used for cost reservation.
      if (endpoint === "responses") {
        let admitted = false;
        try {
          admitted = admitResponse(dispatchInit.body) === true;
        } catch {}
        if (!admitted) deny("generation_proof_refused");
      }
      refusalStage = "cost";
      const inputTokenAllowance = price.maxContextTokens;
      const outputTokenAllowance = endpoint === "responses" ? body.max_output_tokens : 0;
      if (!Number.isSafeInteger(inputTokenAllowance)) deny("input_allowance_overflow");
      const unroundedMicroUsd =
        inputTokenAllowance * price.worstInputUsdPerMillion +
        outputTokenAllowance * (price.worstOutputUsdPerMillion ?? 0);
      if (!Number.isFinite(unroundedMicroUsd) || unroundedMicroUsd > Number.MAX_SAFE_INTEGER - 1) {
        deny("cost_allowance_overflow");
      }
      // One extra micro-USD also avoids under-reservation at a floating-point boundary.
      const microUsd = BigInt(Math.ceil(unroundedMicroUsd) + 1);
      if (microUsd <= 0n) deny("nonpositive_cost_allowance");
      if (reservedMicroUsd + microUsd > budgetMicroUsd) deny("cumulative_budget_exceeded");
      // Synchronous update before the first await makes concurrent calls cumulative.
      reservedMicroUsd += microUsd;
      attempts += 1;
      increment(reservationAttempts, endpoint);
      refusalStage = "reservation";
      const reservation = Object.freeze({
        attempt: attempts,
        endpoint,
        model: body.model,
        wireBytes,
        inputTokenAllowance,
        outputTokenAllowance,
        reservedMicroUsd: microUsd.toString(),
        cumulativeMicroUsd: reservedMicroUsd.toString(),
      });
      // Persist each reservation in order before the corresponding HTTP dispatch. A failed
      // ledger write permanently closes this finite guard; reserved cost is never refunded.
      const write = reservationWriteTail.then(() => {
        if (denial) throw denial;
        return onReserve(reservation);
      });
      reservationWriteTail = write.catch(() => undefined);
      try {
        await write;
      } catch {
        denial ??= new WireBudgetDenied("reservation_commit_failed");
        throw denial;
      }
      if (denial) throw denial;
      refusalStage = "dispatch";
      if (dispatchInit.signal?.aborted) deny("transport_aborted_before_dispatch");
      increment(dispatchAttempts, endpoint);
      return await dispatch(dispatchInput, dispatchInit); // Validated URL/body/headers; no response mutation.
    } catch (error) {
      if (error instanceof WireBudgetDenied) {
        latchRefusal(refusalStage, refusalReason(error, "code", wireRefusalReasons));
        denial ??= error;
      }
      throw error;
    }
  };
  return Object.freeze({
    fetch,
    reject: (stage = "prepared", error) => {
      latchRefusal(stage, refusalReason(error, "message", helperRefusalReasons));
      denial ??= new WireBudgetDenied("generation_proof_refused");
      throw denial;
    },
    snapshot: () =>
      Object.freeze({
        attempts,
        reservedMicroUsd: reservedMicroUsd.toString(),
        remainingMicroUsd: (budgetMicroUsd - reservedMicroUsd).toString(),
        denied: denial ? refusalReason(denial, "code", wireRefusalReasons) : null,
        firstRefusal,
        reservationAttempts: Object.freeze({ ...reservationAttempts }),
        dispatchAttempts: Object.freeze({ ...dispatchAttempts }),
        counterState,
      }),
  });
}
