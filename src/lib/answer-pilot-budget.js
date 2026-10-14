export { answerPilotDiagnosticSources } from "@/lib/answer-pilot-diagnostic";
import {
  answerPilotResponseMatches,
  prepareAnswerPilotGeneration,
  prepareAnswerPilotGenerationSeed,
  createAnswerPilotDiagnostic,
} from "@/lib/answer-pilot-diagnostic";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { PublicApiError } from "@/lib/http";
import { createWireBudgetGuard } from "@/lib/answer-wire-budget-guard";
import { loadServerAnswerPilotTicket } from "@/lib/answer-pilot-ticket";

const budgetScope = new AsyncLocalStorage();
const generationScope = new AsyncLocalStorage();
const queryDigest = (query) => createHash("sha256").update(query, "utf8").digest("hex");

export class AnswerPilotBudgetError extends PublicApiError {
  constructor(code = "answer_pilot_budget_denied") {
    super("The controlled Answer pilot could not complete within its reserved budget.", 503, { code });
  }
}

export const currentAnswerPilotBudget = () => budgetScope.getStore() ?? null;
// Diagnostics are best-effort and cannot change ordinary answer control flow.
export function captureAnswerPilotDiagnostic(stage, sources, details) {
  try {
    currentAnswerPilotBudget()?.diagnostic?.capture(stage, sources, details);
  } catch {}
}
export const isAnswerPilotBudgetActive = () => Boolean(currentAnswerPilotBudget());

export function runAnswerPilotGeneration(context, model, attemptOrdinal, schemaFor, generationWork) {
  const budget = currentAnswerPilotBudget();
  if (!budget) return generationWork();
  let seed;
  try {
    seed = prepareAnswerPilotGenerationSeed(context, model, attemptOrdinal, schemaFor);
  } catch (error) {
    budget.guard.reject("seed", error);
  }
  return generationScope.run(Object.freeze({ seed }), generationWork);
}

// This boundary receives the actual synchronously built input/schema/model from
// createObservedAnswerGenerator. One immutable proof follows that SDK invocation.
export async function runPreparedAnswerPilotGeneration(input, schema, options, generationWork) {
  const budget = currentAnswerPilotBudget();
  if (!budget) return generationWork();
  let proof;
  try {
    proof = prepareAnswerPilotGeneration(generationScope.getStore()?.seed, input, schema, options);
  } catch (error) {
    budget.guard.reject("prepared", error);
  }
  return generationScope.run(Object.freeze({ proof }), async () => {
    const generated = await generationWork();
    if (budget.wasResponseReserved(proof)) {
      try {
        budget.diagnostic?.capturePreparedGeneration(proof, generated);
      } catch {}
    }
    return generated;
  });
}

function pilotIdentityMatches(ticket, request) {
  const digest = queryDigest(request.query);
  const related =
    request.ownerId === ticket.ownerId || request.documentId === ticket.documentId || digest === ticket.querySha256;
  if (!related) return "unrelated";
  const exact =
    !request.summaryMode &&
    ticket.ownerId &&
    ticket.documentId &&
    request.ownerId === ticket.ownerId &&
    request.documentId === ticket.documentId &&
    digest === ticket.querySha256 &&
    request.activeFilterCount === 0 &&
    (request.queryMode ?? "auto") === "auto" &&
    request.resolvedDocumentIds?.length === 1 &&
    request.resolvedDocumentIds[0] === ticket.documentId;
  return exact ? "exact" : "near_match_refused";
}

/** Called only after the real route's authentication, rate limit and document-scope checks. */
export async function runAnswerWithPilotBudget(request, answerWork) {
  let ticket;
  try {
    ticket = await loadServerAnswerPilotTicket();
  } catch {
    throw new AnswerPilotBudgetError("answer_pilot_ticket_load_failed");
  }
  if (!ticket) return answerWork();
  const identity = pilotIdentityMatches(ticket, request);
  if (identity === "unrelated") return answerWork();
  if (identity !== "exact") throw new AnswerPilotBudgetError("answer_pilot_identity_mismatch");
  if (typeof ticket.onReserve !== "function" || !ticket.verifiedPriceTableRef || !ticket.remainingUsd) {
    throw new AnswerPilotBudgetError("answer_pilot_ticket_incomplete");
  }
  // One ticket, one guard, every SDK transport attempt. No global fetch replacement.
  let guard;
  const reservedProofs = new WeakSet();
  try {
    guard = createWireBudgetGuard({
      dispatch: globalThis.fetch,
      remainingUsd: ticket.remainingUsd,
      prices: ticket.prices,
      verifiedPriceTableRef: ticket.verifiedPriceTableRef,
      expectedOrigin: "https://api.openai.com/",
      maxSerializedJsonBytes: ticket.maxSerializedJsonBytes,
      admitResponse: (serializedBody) => answerPilotResponseMatches(generationScope.getStore()?.proof, serializedBody),
      onReserve: async (reservation) => {
        await ticket.onReserve(reservation);
        if (reservation.endpoint === "responses") {
          const proof = generationScope.getStore()?.proof;
          if (!proof) guard.reject();
          reservedProofs.add(proof);
        }
      },
    });
  } catch {
    throw new AnswerPilotBudgetError("answer_pilot_ticket_invalid");
  }
  let diagnostic = null;
  try {
    diagnostic = createAnswerPilotDiagnostic(ticket, guard);
  } catch {}
  // This scope was established by a valid server ticket and exact request identity.
  // Content-free refusal witnesses remain tied to that request if the ticket is
  // later removed/expired. This never grants raw capture or dispatch authority.
  let refusalWitnessEmitted = false;
  const emitRefusalWitness = () => {
    if (refusalWitnessEmitted) return;
    const snapshot = guard.snapshot();
    if (!snapshot.firstRefusal) return;
    refusalWitnessEmitted = true;
    try {
      console.info(
        "answer_pilot_refusal_v1 " +
          JSON.stringify({
            stage: snapshot.firstRefusal.stage,
            reason: snapshot.firstRefusal.reason,
            embeddingReservationAttempts: snapshot.reservationAttempts.embeddings,
            responsesReservationAttempts: snapshot.reservationAttempts.responses,
            embeddingDispatchAttempts: snapshot.dispatchAttempts.embeddings,
            responsesDispatchAttempts: snapshot.dispatchAttempts.responses,
            counterState: snapshot.counterState,
          }),
      );
    } catch {} // A failed diagnostic sink cannot change the public error path.
  };
  return budgetScope.run(
    Object.freeze({ fetch: guard.fetch, guard, diagnostic, wasResponseReserved: (proof) => reservedProofs.has(proof) }),
    async () => {
      try {
        const answer = await answerWork();
        if (guard.snapshot().denied) throw new AnswerPilotBudgetError();
        return answer;
      } catch (error) {
        // RAG's existing provider-fallback catches must not transform a budget refusal
        // into purported source-backed clinical text.
        if (guard.snapshot().denied) {
          emitRefusalWitness();
          throw new AnswerPilotBudgetError();
        }
        throw error;
      }
    },
  );
}
