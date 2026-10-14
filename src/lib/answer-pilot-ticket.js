import { createAdminClient } from "@/lib/supabase/admin";

// Finite server-only pilot. Root must first reserve USD 6 in the existing local
// aggregate ledger and set this ticket in trusted server configuration. Request
// bodies, cookies and headers cannot activate or alter it.
const TICKET_SOURCE = "CONTROLLED_ANSWER_PILOT_TICKET_JSON";
const OWNER_ID = "3ea89594-b3a1-46b7-b570-33c198ce5524";
const DOCUMENT_ID = "d69a6b9c-3e80-556a-b887-53d209238293";
const PRICE_CARD_SHA256 = "A1BE62919DA8A18A5CF33177AF8C06F67CDC1ED607F7C6091D22ED47605CB77F";
const ONE_HOUR_MS = 3_600_000;
const CLAIM_WINDOW_SECONDS = 86_400;
const expectedKeys = new Set([
  "version",
  "ownerId",
  "documentId",
  "querySha256",
  "nonce",
  "issuedAtUtc",
  "expiresAtUtc",
  "ledgerReservationRef",
  "ledgerReservedUsd",
  "priceCardSha256",
  "maxSerializedJsonBytes",
]);

// Root-observed official standard/default worst-case price card, pinned above.
// maxOutputTokens is the bounded pilot source cap (16k default, 32k strong retry);
// the guard reserves the serialized request's actual cap on each transport.
const prices = Object.freeze({
  "gpt-5.6-terra": Object.freeze({
    endpoint: "responses",
    maxContextTokens: 1_050_000,
    maxOutputTokens: 32_000,
    worstInputUsdPerMillion: 5,
    worstOutputUsdPerMillion: 18,
  }),
  "gpt-5.6-luna": Object.freeze({
    endpoint: "responses",
    maxContextTokens: 1_050_000,
    maxOutputTokens: 32_000,
    worstInputUsdPerMillion: 0.5,
    worstOutputUsdPerMillion: 1.8,
  }),
  "gpt-5.6-sol": Object.freeze({
    endpoint: "responses",
    maxContextTokens: 1_050_000,
    maxOutputTokens: 32_000,
    worstInputUsdPerMillion: 10,
    worstOutputUsdPerMillion: 30,
  }),
  "text-embedding-3-small": Object.freeze({
    endpoint: "embeddings",
    maxContextTokens: 8_192,
    worstInputUsdPerMillion: 0.02,
  }),
});

const fail = () => {
  throw new Error("answer_pilot_ticket_invalid");
};
const utcMs = (value) =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;

function parseTrustedTicket(raw) {
  let ticket;
  try {
    ticket = JSON.parse(raw);
  } catch {
    fail();
  }
  if (
    !ticket ||
    typeof ticket !== "object" ||
    Array.isArray(ticket) ||
    Object.keys(ticket).length !== expectedKeys.size ||
    !Object.keys(ticket).every((key) => expectedKeys.has(key))
  )
    fail();
  const issued = utcMs(ticket.issuedAtUtc);
  const expires = utcMs(ticket.expiresAtUtc);
  const now = Date.now();
  if (
    ticket.version !== 1 ||
    ticket.ownerId !== OWNER_ID ||
    ticket.documentId !== DOCUMENT_ID ||
    typeof ticket.querySha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(ticket.querySha256) ||
    typeof ticket.nonce !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ticket.nonce) ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now ||
    now >= expires ||
    expires <= issued ||
    expires - issued > ONE_HOUR_MS ||
    typeof ticket.ledgerReservationRef !== "string" ||
    !/^[A-Za-z0-9:_./-]{8,160}$/.test(ticket.ledgerReservationRef) ||
    ticket.ledgerReservedUsd !== "6.000000" ||
    ticket.priceCardSha256 !== PRICE_CARD_SHA256 ||
    !Number.isSafeInteger(ticket.maxSerializedJsonBytes) ||
    ticket.maxSerializedJsonBytes < 1 ||
    ticket.maxSerializedJsonBytes > 262_144
  )
    fail();
  return Object.freeze({
    ownerId: ticket.ownerId,
    documentId: ticket.documentId,
    querySha256: ticket.querySha256,
    nonce: ticket.nonce,
    expiresAtMs: expires,
    ledgerReservationRef: ticket.ledgerReservationRef,
    maxSerializedJsonBytes: ticket.maxSerializedJsonBytes,
  });
}

function acceptedClaim(data, expiryMs) {
  if (!Array.isArray(data) || data.length !== 1) return false;
  const row = data[0];
  return (
    row &&
    row.limited === false &&
    row.limit_value === 1 &&
    row.remaining === 0 &&
    Number.isSafeInteger(row.retry_after_seconds) &&
    row.retry_after_seconds > 0 &&
    typeof row.reset_at === "string" &&
    Date.parse(row.reset_at) >= expiryMs
  );
}

export async function loadServerAnswerPilotTicket() {
  const raw = process.env[TICKET_SOURCE];
  if (raw === undefined) return null; // Closed default, with no privileged client creation.
  const pinned = parseTrustedTicket(raw);
  const assertCurrent = () => {
    if (process.env[TICKET_SOURCE] !== raw || Date.now() >= pinned.expiresAtMs) fail();
  };
  let claimPromise;
  let claimedResponseAttempt = false;
  const onReserve = async (reservation) => {
    assertCurrent();
    // The SQL RPC atomically increments the same (subject_key,bucket) row across
    // processes. Each loaded ticket has its own promise; only this guard's later
    // SDK attempts reuse a successful claim. Ambiguous/lost acknowledgements deny.
    claimPromise ??= (async () => {
      const { data, error } = await createAdminClient().rpc("consume_api_subject_rate_limit", {
        p_subject_key: `controlled-answer-pilot:${pinned.nonce}`,
        p_bucket: "controlled_answer_pilot",
        p_limit: 1,
        p_window_seconds: CLAIM_WINDOW_SECONDS,
      });
      if (error || !acceptedClaim(data, pinned.expiresAtMs)) fail();
    })();
    await claimPromise;
    assertCurrent(); // An expired/removed/changed ticket cannot dispatch after RPC delay.
    if (reservation?.endpoint === "responses") claimedResponseAttempt = true;
  };
  return Object.freeze({
    ownerId: pinned.ownerId,
    documentId: pinned.documentId,
    querySha256: pinned.querySha256,
    ledgerReservationRef: pinned.ledgerReservationRef,
    remainingUsd: "6.000000",
    verifiedPriceTableRef: PRICE_CARD_SHA256,
    prices,
    maxSerializedJsonBytes: pinned.maxSerializedJsonBytes,
    onReserve,
    // Diagnostic permission is server-only, claim-bound, revocable and never throws.
    diagnosticCurrent: () => {
      try {
        assertCurrent();
        return claimedResponseAttempt;
      } catch {
        return false;
      }
    },
  });
}
