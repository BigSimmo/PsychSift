import { z } from "zod";
import { clinicalAskModeIds, type ClinicalAskStreamEvent } from "@/lib/clinical-ask/contracts";
import { clinicalAskSectionTitle } from "@/lib/clinical-ask/mode-profiles";

const contextValue = z.union([z.string().max(500), z.array(z.string().max(500)).max(20)]);
const contextSchema = z.record(z.string(), contextValue);
const evidenceSchema = z
  .object({
    id: z.string(),
    tier: z.enum(["catalogue", "indexed", "external"]),
    title: z.string(),
    publisher: z.string(),
    jurisdiction: z.string().nullable(),
    href: z.string(),
    extract: z.string().max(2_000),
    reviewState: z.enum(["reviewed", "needs_review", "unknown"]),
    publishedAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    retrievedAt: z.string().nullable(),
  })
  .strict();
const claimSchema = z.object({ id: z.string(), text: z.string(), evidenceIds: z.array(z.string()).min(1) }).strict();
const suggestionSchema = z
  .object({
    id: z.string(),
    field: z.string(),
    value: contextValue,
    status: z.enum(["suggested", "confirmed", "rejected"]),
  })
  .strict();
const clarificationRequiredSchema = z
  .object({
    state: z.literal("clarification_required"),
    mode: z.enum(clinicalAskModeIds),
    suggestions: z.array(suggestionSchema),
    clarifications: z.array(
      z.object({ id: z.string(), field: z.string(), prompt: z.string(), required: z.literal(true) }).strict(),
    ),
  })
  .strict();
const handoffSchema = z
  .object({ targetMode: z.enum(clinicalAskModeIds), label: z.string(), acceptedContext: contextSchema })
  .strict();
const answeredSchema = z
  .object({
    state: z.literal("answered"),
    mode: z.enum(clinicalAskModeIds),
    lead: claimSchema,
    sections: z.array(z.object({ id: z.string(), title: z.string(), claims: z.array(claimSchema) }).strict()),
    evidence: z.array(evidenceSchema).min(1),
    conflicts: z.array(claimSchema),
    missingInformation: z.array(z.string()),
    followUps: z.array(z.string()),
    handoffs: z.array(handoffSchema),
  })
  .strict();
const responseSchema = z
  .discriminatedUnion("state", [
    clarificationRequiredSchema,
    answeredSchema,
    z
      .object({
        state: z.literal("evidence_gap"),
        mode: z.enum(clinicalAskModeIds),
        explanation: z.string(),
        evidence: z.array(evidenceSchema),
        missingInformation: z.array(z.string()),
        nextActions: z.array(z.string()),
      })
      .strict(),
    z
      .object({
        state: z.literal("failed"),
        mode: z.enum(clinicalAskModeIds),
        code: z.enum([
          "invalid_request",
          "identifiable_input_blocked",
          "mode_unavailable",
          "unauthorized",
          "rate_limited",
          "retrieval_unavailable",
          "external_unavailable",
          "synthesis_invalid",
          "provider_unavailable",
          "timeout",
          "aborted",
          "internal_error",
        ]),
        retryable: z.boolean(),
        message: z.string(),
      })
      .strict(),
  ])
  .superRefine((response, context) => {
    if (response.state !== "answered") return;
    const evidenceIds = new Set(response.evidence.map((item) => item.id));
    const claims = [response.lead, ...response.sections.flatMap((section) => section.claims), ...response.conflicts];
    for (const claim of claims) {
      for (const evidenceId of claim.evidenceIds) {
        if (evidenceIds.has(evidenceId)) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Claim ${claim.id} references unknown evidence.`,
          path: ["evidence"],
        });
      }
    }
  })
  .transform((response) =>
    response.state === "answered"
      ? {
          ...response,
          sections: response.sections.map((section) => ({
            ...section,
            title: clinicalAskSectionTitle(response.mode, section.id),
          })),
        }
      : response,
  );
const progressSchema = z
  .object({
    type: z.literal("progress"),
    stage: z.enum([
      "validating",
      "confirming_context",
      "clarifying",
      "catalogue",
      "indexed",
      "external",
      "synthesizing",
      "governing",
      "complete",
    ]),
    elapsedMs: z.number().nonnegative(),
  })
  .strict();
const eventSchema = z.discriminatedUnion("type", [
  progressSchema,
  z.object({ type: z.literal("context_suggestions"), suggestions: z.array(suggestionSchema) }).strict(),
  z.object({ type: z.literal("clarification"), response: clarificationRequiredSchema }).strict(),
  z.object({ type: z.literal("evidence"), evidence: z.array(evidenceSchema) }).strict(),
  z
    .object({
      type: z.literal("final"),
      payload: z
        .object({
          response: responseSchema,
          feedback: z
            .object({ interactionId: z.string(), answerHash: z.string(), feedbackToken: z.string() })
            .strict()
            .nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum([
        "invalid_request",
        "identifiable_input_blocked",
        "mode_unavailable",
        "unauthorized",
        "rate_limited",
        "retrieval_unavailable",
        "external_unavailable",
        "synthesis_invalid",
        "provider_unavailable",
        "timeout",
        "aborted",
        "internal_error",
      ]),
      retryable: z.boolean(),
      message: z.string(),
    })
    .strict(),
]);

const stageOrder = [
  "validating",
  "confirming_context",
  "clarifying",
  "catalogue",
  "indexed",
  "external",
  "synthesizing",
  "governing",
  "complete",
] as const;

export function encodeClinicalAskSse(event: ClinicalAskStreamEvent): string {
  const parsed = eventSchema.parse(event) as ClinicalAskStreamEvent;
  return `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`;
}

export function parseClinicalAskSseFrame(frame: string): ClinicalAskStreamEvent | null {
  if (frame.startsWith(":")) return null;
  const lines = frame.trim().split(/\r?\n/);
  const eventName = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!eventName || !data) throw new Error("Malformed Clinical Ask stream frame.");
  const parsed = eventSchema.parse(JSON.parse(data)) as ClinicalAskStreamEvent;
  if (parsed.type !== eventName) throw new Error("Clinical Ask event name does not match its payload.");
  return parsed;
}

export class ClinicalAskSseEncoder {
  private lastStage = -1;
  private terminal = false;

  encode(event: ClinicalAskStreamEvent) {
    if (this.terminal) throw new Error("Clinical Ask stream already terminated.");
    const frame = encodeClinicalAskSse(event);
    if (event.type === "progress") {
      const next = stageOrder.indexOf(event.stage);
      if (next < this.lastStage) throw new Error("Clinical Ask progress regressed.");
      this.lastStage = next;
    }
    if (event.type === "final" || event.type === "error") this.terminal = true;
    return frame;
  }
}

export const clinicalAskHeartbeatFrame = ": heartbeat\n\n";
