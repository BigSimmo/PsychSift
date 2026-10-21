import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ClinicalAskDependencies,
  ClinicalAskDraft,
  ClinicalAskEvidence,
  ClinicalAskRequest,
} from "@/lib/clinical-ask/contracts";
import { clinicalAskModeProfile } from "@/lib/clinical-ask/mode-profiles";
import { runClinicalAsk } from "@/lib/clinical-ask/orchestrator";

const question = "Which example evidence applies?";
const claimText = "The source indicates which example evidence applies.";
// The extract has to speak to every section in the services profile, because
// `annotateEvidenceCoverage` tests each section against the passage rather than
// copying one request-level verdict across all of them. The eligibility and
// referral-pathway wording is what makes this fixture sufficient; without it the
// orchestrator correctly seeks external corroboration and these routing tests
// would be asserting against a passage that does not in fact cover the answer.
const evidence = (reviewState: ClinicalAskEvidence["reviewState"] = "reviewed"): ClinicalAskEvidence => ({
  id: `catalogue:${reviewState}`,
  tier: "catalogue",
  title: "Synthetic evidence",
  publisher: "Synthetic publisher",
  jurisdiction: null,
  href: "/synthetic",
  extract:
    `${question} example location adult assessment review ${claimText} ` +
    "Eligibility: the example service accepts referrals for adults. " +
    "Referral pathway: contact the intake team.",
  reviewState,
  publishedAt: "2026-01-01",
  updatedAt: "2026-06-01",
  retrievedAt: null,
});
const completeContext = {
  serviceLocation: "example location",
  population: "adult",
  pathwayStage: "assessment",
  referralPurpose: "review",
};
const request = (overrides: Partial<ClinicalAskRequest> = {}): ClinicalAskRequest => ({
  mode: "services",
  question,
  confirmedContext: completeContext,
  clarificationAnswers: {},
  priorTurns: [],
  allowExternalFallback: true,
  inputTransport: "typed",
  ...overrides,
});
function validDraft(source = evidence()): ClinicalAskDraft {
  const profile = clinicalAskModeProfile("services");
  const claim = (id: string) => ({ id, text: claimText, evidenceIds: [source.id] });
  return {
    mode: "services",
    lead: claim("lead"),
    sections: profile.sectionOrder.map((id) => ({ id, title: id, claims: [claim(id)] })),
    conflicts: [],
    missingInformation: [],
    followUps: [],
    handoffs: [],
  };
}
function fakes(local: ClinicalAskEvidence[] = [evidence()]) {
  return {
    suggestContext: vi.fn<ClinicalAskDependencies["suggestContext"]>().mockResolvedValue([]),
    retrieveCatalogue: vi.fn<ClinicalAskDependencies["retrieveCatalogue"]>().mockResolvedValue(local),
    retrieveIndexed: vi.fn<ClinicalAskDependencies["retrieveIndexed"]>().mockResolvedValue([]),
    retrieveExternal: vi.fn<ClinicalAskDependencies["retrieveExternal"]>().mockResolvedValue([]),
    synthesize: vi.fn<ClinicalAskDependencies["synthesize"]>().mockImplementation(async () => validDraft(local[0])),
  };
}
const scope = { ownerId: "owner-a", includePublic: true };

afterEach(() => vi.useRealTimers());

describe("runClinicalAsk", () => {
  it("returns material clarification before retrieval", async () => {
    const dependencies = fakes();
    const response = await runClinicalAsk(
      request({ confirmedContext: {} }),
      scope,
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );
    expect(response.state).toBe("clarification_required");
    expect(dependencies.retrieveCatalogue).not.toHaveBeenCalled();
  });

  it("continues after the clinician answers every requested clarification", async () => {
    const dependencies = fakes();
    const response = await runClinicalAsk(
      request({
        confirmedContext: {},
        clarificationAnswers: {
          "services:serviceLocation": "example location",
          "services:population": "adult",
          "services:pathwayStage": "assessment",
          "services:referralPurpose": "review",
        },
      }),
      scope,
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );
    expect(response.state).toBe("answered");
    expect(dependencies.retrieveCatalogue).toHaveBeenCalledOnce();
  });

  it("reports an evidence gap without synthesis when no tier returns evidence", async () => {
    const dependencies = fakes([]);
    const response = await runClinicalAsk(
      request({ allowExternalFallback: false }),
      scope,
      dependencies,
      new AbortController().signal,
      () => {},
    );
    expect(response.state).toBe("evidence_gap");
    if (response.state === "evidence_gap") expect(response.evidence).toEqual([]);
    expect(dependencies.retrieveCatalogue).toHaveBeenCalledOnce();
    expect(dependencies.retrieveIndexed).toHaveBeenCalledOnce();
    expect(dependencies.synthesize).not.toHaveBeenCalled();
  });

  it("skips external retrieval when local evidence is sufficient", async () => {
    const dependencies = fakes();
    const response = await runClinicalAsk(request(), scope, dependencies, new AbortController().signal, vi.fn());
    expect(response.state).toBe("answered");
    expect(dependencies.retrieveExternal).not.toHaveBeenCalled();
  });

  it("uses external only when preference permits it", async () => {
    const local = evidence("needs_review");
    const external = { ...evidence(), id: "external:reviewed", tier: "external" as const };
    const dependencies = fakes([local]);
    dependencies.retrieveExternal.mockResolvedValue([external]);
    dependencies.synthesize.mockImplementation(async () => validDraft(external));
    await runClinicalAsk(request(), scope, dependencies, new AbortController().signal, vi.fn());
    expect(dependencies.retrieveExternal).toHaveBeenCalledTimes(1);

    const disabled = fakes([local]);
    await runClinicalAsk(
      request({ allowExternalFallback: false }),
      scope,
      disabled,
      new AbortController().signal,
      vi.fn(),
    );
    expect(disabled.retrieveExternal).not.toHaveBeenCalled();
  });

  it("degrades safely when external retrieval fails", async () => {
    const local = evidence("needs_review");
    const dependencies = fakes([local]);
    dependencies.retrieveExternal.mockRejectedValue(new Error("synthetic external failure"));
    const response = await runClinicalAsk(request(), scope, dependencies, new AbortController().signal, vi.fn());
    expect(["answered", "evidence_gap"]).toContain(response.state);
  });

  it("retries invalid synthesis at most once and reruns governance", async () => {
    const dependencies = fakes();
    const invalid = validDraft();
    invalid.lead.evidenceIds = [];
    dependencies.synthesize.mockResolvedValueOnce(invalid).mockResolvedValueOnce(validDraft());
    const stages: string[] = [];
    const response = await runClinicalAsk(request(), scope, dependencies, new AbortController().signal, (event) =>
      stages.push(event.stage),
    );
    expect(response.state).toBe("answered");
    expect(dependencies.synthesize).toHaveBeenCalledTimes(2);
    expect(stages).toEqual([...new Set(stages)]);
  });

  it("blocks identifier-shaped input before every injected dependency", async () => {
    const dependencies = fakes();
    const response = await runClinicalAsk(
      request({ question: "Review patient@example.com" }),
      scope,
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );
    expect(response).toMatchObject({ state: "failed", code: "identifiable_input_blocked" });
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  // Audit ARCH-06 (2026-10-20): the orchestrator is the second check before provider calls, so it uses
  // Answer's patient-detail check too. Synthetic examples only.
  it.each([
    ["question", request({ question: "Mrs Jones in bed 4, 82, on clozapine - next step?" })],
    [
      "confirmed context",
      request({ confirmedContext: { ...completeContext, referralPurpose: "review for Mr Smith" } }),
    ],
    [
      "clarification answer",
      request({
        confirmedContext: {},
        clarificationAnswers: {
          "services:serviceLocation": "Ward 4 Ms Smith",
          "services:population": "adult",
          "services:pathwayStage": "assessment",
          "services:referralPurpose": "review",
        },
      }),
    ],
  ] as const)("blocks a name-plus-title patient detail in the %s before every dependency", async (_where, input) => {
    const dependencies = fakes();
    const response = await runClinicalAsk(input, scope, dependencies, new AbortController().signal, vi.fn());
    expect(response).toMatchObject({ state: "failed", code: "identifiable_input_blocked" });
    expect(JSON.stringify(response)).not.toMatch(/Jones|Smith/);
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it("still answers an ordinary clinical question that holds an age", async () => {
    const dependencies = fakes();
    const response = await runClinicalAsk(
      request({ question: `${question} For a 70 year old with CKD?` }),
      scope,
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );
    expect(response.state).not.toBe("failed");
    expect(dependencies.suggestContext).toHaveBeenCalled();
  });

  it("stops later tiers after abort", async () => {
    const controller = new AbortController();
    const dependencies = fakes();
    dependencies.retrieveCatalogue.mockImplementation(async (_request: ClinicalAskRequest, signal: AbortSignal) => {
      controller.abort();
      signal.throwIfAborted();
      return [];
    });
    const response = await runClinicalAsk(request(), scope, dependencies, controller.signal, vi.fn());
    expect(response).toMatchObject({ state: "failed", code: "aborted" });
    expect(dependencies.retrieveIndexed).not.toHaveBeenCalled();
    expect(dependencies.synthesize).not.toHaveBeenCalled();
  });

  it("returns an evidence-only fallback at the 45-second deadline", async () => {
    vi.useFakeTimers();
    const dependencies = fakes();
    dependencies.retrieveIndexed.mockImplementation(() => new Promise(() => undefined));
    const pending = runClinicalAsk(request(), scope, dependencies, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(45_000);
    const response = await pending;
    expect(response.state).toBe("evidence_gap");
    if (response.state === "evidence_gap") {
      expect(response.evidence).toHaveLength(1);
      expect(response.evidence[0]?.extract).toBe("");
    }
  });
});
