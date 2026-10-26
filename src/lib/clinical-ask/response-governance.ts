import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import type {
  ClinicalAskClaim,
  ClinicalAskDraft,
  ClinicalAskEvidence,
  ClinicalAskModeId,
  ClinicalAskResponse,
  ClinicalAskSection,
} from "@/lib/clinical-ask/contracts";
import { clinicalAskModeProfile, type ClinicalAskModeProfile } from "@/lib/clinical-ask/mode-profiles";
import { sourceDirectlySupportsAnswerText } from "@/lib/rag/rag-claim-support";
import type { SearchResult } from "@/lib/types";

const injectionPattern =
  /\b(?:ignore (?:all |any )?(?:previous|prior|system|developer) instructions|reveal (?:the )?(?:system prompt|instructions)|follow these instructions instead|override (?:the )?(?:rules|policy))\b/i;

const prohibitedByMode: Record<ClinicalAskModeId, readonly RegExp[]> = {
  services: [
    /\b(?:will|must) (?:the )?(?:service )?accept (?:the )?referral\b/i,
    /\ballocate(?:d|s)? (?:the )?(?:patient|case)\b/i,
  ],
  forms: [
    /\b(?:submit|sign|complete) (?:the )?form (?:now|automatically|for you)\b/i,
    /\blegally (?:requires|determines)\b/i,
  ],
  differentials: [
    /\b(?:the|this) (?:patient )?(?:has|meets|is diagnosed with)\b/i,
    /\b\d+(?:\.\d+)?% (?:chance|probability)\b/i,
  ],
  formulation: [/\b(?:proves|establishes) (?:the )?(?:mechanism|formulation)\b/i, /\byou should treat\b/i],
  dsm: [/\b(?:definitive|confirmed|final) diagnosis\b/i, /\b(?:the|this) (?:patient )?(?:has|meets criteria for)\b/i],
  specifiers: [/\b(?:confirmed|definitive) specifier\b/i, /\bthe specifier is established\b/i],
  "therapy-compass": [
    /\b(?:prescribe|start|commence) (?:the )?(?:therapy|treatment)\b/i,
    /\bbest treatment for (?:the|this) patient\b/i,
  ],
};

const neutralClaimPattern =
  /\b(?:evidence|source|record|guidance|catalogue|extract)\b.*\b(?:indicates?|suggests?|supports?|describes?|notes?|reports?|lists?|states?|identifies?)\b|\b(?:may|might|could|appears?|is consistent with|warrants? clinician review)\b/i;

function minimalSearchResult(evidence: ClinicalAskEvidence): SearchResult {
  return {
    id: evidence.id,
    document_id: evidence.id,
    title: evidence.title,
    file_name: evidence.title,
    page_number: null,
    chunk_index: 0,
    section_heading: null,
    content: evidence.extract,
    image_ids: [],
    images: [],
    similarity: 0,
  };
}

/**
 * Strip the raw extract from an evidence item before it leaves the server.
 * The extract is only needed server-side for governance checks; sending it to
 * the browser would expose raw external-search text, violating the server-only
 * contract in docs/clinical-governance.md.
 */
export function publicClinicalAskEvidence(items: readonly ClinicalAskEvidence[]): ClinicalAskEvidence[] {
  return items.map((item) => ({ ...item, extract: "" }));
}

function safeAuxiliaryText(mode: ClinicalAskModeId, values: readonly string[]): string[] {
  return values.flatMap((value) => {
    const text = value.trim();
    return text &&
      text.length <= 500 &&
      !identifierShapeWarning(text) &&
      !injectionPattern.test(text) &&
      !prohibitedByMode[mode].some((pattern) => pattern.test(text))
      ? [text]
      : [];
  });
}

function governedClaim(
  mode: ClinicalAskModeId,
  claim: ClinicalAskClaim,
  evidenceById: ReadonlyMap<string, ClinicalAskEvidence>,
): ClinicalAskClaim | null {
  const text = claim.text.trim();
  if (!text || injectionPattern.test(text) || prohibitedByMode[mode].some((pattern) => pattern.test(text))) return null;
  if (!neutralClaimPattern.test(text)) return null;
  const cited = [...new Set(claim.evidenceIds)].map((id) => evidenceById.get(id)).filter(Boolean);
  if (cited.length === 0 || cited.length !== new Set(claim.evidenceIds).size) return null;
  const hasDirectSupport = cited.some((item) =>
    sourceDirectlySupportsAnswerText(text, minimalSearchResult(item as ClinicalAskEvidence)),
  );
  if (!hasDirectSupport) return null;
  return { ...claim, text, evidenceIds: [...new Set(claim.evidenceIds)] };
}

function evidenceGap(
  profile: ClinicalAskModeProfile,
  evidence: readonly ClinicalAskEvidence[],
  missingInformation: readonly string[],
): ClinicalAskResponse {
  return {
    state: "evidence_gap",
    mode: profile.id,
    explanation: "The available evidence does not directly support every required part of this answer.",
    evidence: publicClinicalAskEvidence(evidence),
    missingInformation: [...new Set(safeAuxiliaryText(profile.id, missingInformation))],
    nextActions: ["Review the linked evidence", "Clarify the unsupported clinical details"],
  };
}

export function governClinicalAskDraft(
  profile: ClinicalAskModeProfile,
  draft: ClinicalAskDraft,
  evidence: readonly ClinicalAskEvidence[],
): ClinicalAskResponse {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (draft.mode !== profile.id || draft.sections.map(({ id }) => id).join("|") !== profile.sectionOrder.join("|")) {
    return evidenceGap(profile, evidence, [...draft.missingInformation, "The answer structure was invalid."]);
  }

  const lead = governedClaim(profile.id, draft.lead, evidenceById);
  const sections: ClinicalAskSection[] = draft.sections.map((section) => ({
    ...section,
    claims: section.claims.flatMap((claim) => {
      const governed = governedClaim(profile.id, claim, evidenceById);
      return governed ? [governed] : [];
    }),
  }));
  const missingSections = sections.filter(({ claims }) => claims.length === 0).map(({ id }) => id);
  if (!lead || missingSections.length > 0) {
    return evidenceGap(profile, evidence, [...draft.missingInformation, ...missingSections]);
  }

  const conflicts = draft.conflicts.flatMap((claim) => {
    const governed = governedClaim(profile.id, claim, evidenceById);
    return governed ? [governed] : [];
  });
  return {
    state: "answered",
    mode: profile.id,
    lead,
    sections,
    evidence: publicClinicalAskEvidence(evidence),
    conflicts,
    missingInformation: safeAuxiliaryText(profile.id, draft.missingInformation),
    followUps: safeAuxiliaryText(profile.id, draft.followUps),
    handoffs: draft.handoffs
      .filter((handoff) => profile.handoffModes.includes(handoff.targetMode))
      .map((handoff) => ({
        ...handoff,
        label: `Continue to ${clinicalAskModeProfile(handoff.targetMode).label}`,
      })),
  };
}
