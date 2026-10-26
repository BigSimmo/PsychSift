import type { DocumentLabel, DocumentLabelType } from "@/lib/types";

export type SmartDocumentTagGroup =
  | "Site"
  | "Medication"
  | "Risk"
  | "Workflow"
  | "Topic"
  | "Population"
  | "Setting"
  | "Service"
  | "Document type"
  | "Clinical action"
  | "Care phase"
  | "Document intent"
  | "Content feature"
  | "Manual";

export type SmartDocumentTagTier = "primary" | "secondary" | "ranking";
export type DocumentLabelReviewStatus = "new" | "approved" | "hidden";

export type SmartDocumentTag = {
  key: string;
  label: string;
  searchText: string;
  label_type: DocumentLabelType;
  group: SmartDocumentTagGroup;
  tier: SmartDocumentTagTier;
  reviewStatus: DocumentLabelReviewStatus;
  source: DocumentLabel["source"];
  confidence: number;
  score: number;
  queryMatched: boolean;
};

export type SmartDocumentTagFacet = {
  key: string;
  label: string;
  searchText: string;
  group: SmartDocumentTagGroup;
  count: number;
};

export type SmartDocumentTagGroupResult = {
  group: SmartDocumentTagGroup;
  tags: SmartDocumentTag[];
};

export type SmartDocumentTagFacetGroup = {
  group: SmartDocumentTagGroup;
  facets: SmartDocumentTagFacet[];
};

export type SmartDocumentTagFacetIndex<T extends ClinicalTagSource> = {
  entries: Array<{
    document: T;
    tagKeys: Set<string>;
    tags: SmartDocumentTag[];
  }>;
  groups: SmartDocumentTagFacetGroup[];
};

export type SmartDocumentTagQualityIssueKind = "noisy" | "duplicate" | "low_confidence" | "overused";

export type SmartDocumentTagQualityIssue = {
  kind: SmartDocumentTagQualityIssueKind;
  label: string;
  canonicalLabel?: string;
  label_type?: DocumentLabelType;
  count: number;
  reason: string;
  examples: string[];
  documentTitles: string[];
};

export type NormalizedDocumentLabel = {
  label: string;
  label_type: DocumentLabelType;
  confidence: number;
};

type LabelCandidate = {
  label?: unknown;
  label_type?: unknown;
  confidence?: unknown;
  source?: unknown;
};

const labelTypes = new Set<DocumentLabelType>([
  "topic",
  "document_type",
  "medication",
  "risk",
  "site",
  "setting",
  "workflow",
  "population",
  "service",
  "clinical_action",
  "care_phase",
  "document_intent",
  "content_feature",
  "custom",
]);

const groupLabels: Record<DocumentLabelType, SmartDocumentTagGroup> = {
  site: "Site",
  medication: "Medication",
  risk: "Risk",
  workflow: "Workflow",
  topic: "Topic",
  population: "Population",
  setting: "Setting",
  service: "Service",
  document_type: "Document type",
  clinical_action: "Clinical action",
  care_phase: "Care phase",
  document_intent: "Document intent",
  content_feature: "Content feature",
  custom: "Topic",
};

const groupRank: Record<SmartDocumentTagGroup, number> = {
  Site: 0,
  Medication: 1,
  "Clinical action": 2,
  "Care phase": 3,
  "Document intent": 4,
  Risk: 5,
  Workflow: 6,
  Topic: 7,
  Service: 8,
  Setting: 9,
  Population: 10,
  "Document type": 11,
  "Content feature": 12,
  Manual: 13,
};

export const smartDocumentFacetGroups: SmartDocumentTagGroup[] = [
  "Site",
  "Medication",
  "Clinical action",
  "Care phase",
  "Document intent",
  "Risk",
  "Workflow",
  "Setting",
  "Population",
  "Service",
  "Document type",
];

const acronymDisplay = new Map([
  ["akg", "AKG"],
  ["anc", "ANC"],
  ["bsl", "BSL"],
  ["cbt", "CBT"],
  ["covid", "COVID"],
  ["ctt", "CTT"],
  ["ct", "CT"],
  ["ed", "ED"],
  ["ect", "ECT"],
  ["fbc", "FBC"],
  ["gp", "GP"],
  ["hr", "HR"],
  ["honos", "HoNOS"],
  ["honosca", "HoNOSCA"],
  ["im", "IM"],
  ["iv", "IV"],
  ["lai", "LAI"],
  ["mh", "MH"],
  ["mhat", "MHAT"],
  ["mhoa", "MHOA"],
  ["mhsp", "MHSP"],
  ["nocc", "NOCC"],
  ["nsaids", "NSAIDs"],
  ["nmhs", "NMHS"],
  ["prn", "PRN"],
  ["rpbg", "RPBG"],
  ["qtc", "QTc"],
  ["rkpg", "RKPG"],
  ["smhs", "SMHS"],
  ["wcc", "WCC"],
]);

const labelDisplayOverrides = new Map([
  ["assessment_tool", "Assessment tool"],
  ["prescribing_aid", "Prescribing aid"],
  ["electroconvulsive-therapy", "Electroconvulsive therapy"],
  ["substance use alcohol and drugs", "Substance use, alcohol and drugs"],
  ["substance-use-alcohol-and-drugs", "Substance use, alcohol and drugs"],
  ["aggression violence code black", "Aggression, violence and Code Black"],
  ["admission waitlist bed access", "Admission, waitlist and bed access"],
  ["physical health care", "Physical health care"],
  ["post discharge follow up", "Post-discharge follow-up"],
  ["post-discharge-follow-up", "Post-discharge follow-up"],
  ["initial assessment", "Initial assessment"],
  ["initial-assessment", "Initial assessment"],
  ["acute management", "Acute management"],
  ["acute-management", "Acute management"],
  ["crisis response", "Crisis response"],
  ["crisis-response", "Crisis response"],
  ["ongoing management", "Ongoing management"],
  ["ongoing-management", "Ongoing management"],
  ["maintenance treatment", "Maintenance treatment"],
  ["maintenance-treatment", "Maintenance treatment"],
  ["discharge planning", "Discharge planning"],
  ["discharge-planning", "Discharge planning"],
  ["clinical instruction", "Clinical instruction"],
  ["clinical-instruction", "Clinical instruction"],
  ["decision support", "Decision support"],
  ["decision-support", "Decision support"],
  ["patient information", "Patient information"],
  ["patient-information", "Patient information"],
  ["staff guidance", "Staff guidance"],
  ["staff-guidance", "Staff guidance"],
  ["legal governance", "Legal governance"],
  ["legal-governance", "Legal governance"],
  ["operational process", "Operational process"],
  ["operational-process", "Operational process"],
  ["documentation requirement", "Documentation requirement"],
  ["documentation-requirement", "Documentation requirement"],
  ["medication instruction", "Medication instruction"],
  ["medication-instruction", "Medication instruction"],
  ["contains table", "Contains table"],
  ["contains-table", "Contains table"],
  ["contains flowchart", "Contains flowchart"],
  ["contains-flowchart", "Contains flowchart"],
  ["contains form", "Contains form"],
  ["contains-form", "Contains form"],
  ["contains dosage guidance", "Contains dosage guidance"],
  ["contains-dosage-guidance", "Contains dosage guidance"],
  ["contains monitoring schedule", "Contains monitoring schedule"],
  ["contains-monitoring-schedule", "Contains monitoring schedule"],
  ["contains referral criteria", "Contains referral criteria"],
  ["contains-referral-criteria", "Contains referral criteria"],
  ["contains escalation criteria", "Contains escalation criteria"],
  ["contains-escalation-criteria", "Contains escalation criteria"],
  ["contains legal criteria", "Contains legal criteria"],
  ["contains-legal-criteria", "Contains legal criteria"],
  ["contains quick reference", "Contains quick reference"],
  ["contains-quick-reference", "Contains quick reference"],
  ["de escalate", "De-escalate"],
  ["de-escalate", "De-escalate"],
]);

const lowercaseDisplayWords = new Set(["and", "or", "of", "for", "from", "to", "in", "with"]);

const rankingOnlyLabels = new Set([
  "clinical risk",
  "mental health",
  "inpatient",
  "assessment",
  "monitoring",
  "physical health care",
  "admission waitlist bed access",
  "clinical",
  "non clinical",
  "admin",
  "assess",
  "refer",
  "review",
  "document",
  "clinical instruction",
  "documentation requirements",
]);

const clinicalActionLabels = new Set([
  "assess",
  "prescribe",
  "administer",
  "monitor",
  "escalate",
  "refer",
  "admit",
  "discharge",
  "transfer",
  "observe",
  "notify",
  "review",
  "document",
  "de-escalate",
]);

const primaryLabelTypes = new Set<DocumentLabelType>([
  "site",
  "medication",
  "clinical_action",
  "care_phase",
  "document_intent",
  "risk",
]);

const siteShortLabels = new Map([
  ["armadale kalamunda group", "AKG"],
  ["bentley health service", "BHS"],
  ["bmj best practice", "BMJ"],
  ["child and adolescent mental health service", "CAMHS"],
  ["east metropolitan health service", "EMHS"],
  ["fiona stanley hospital", "FSH"],
  ["fremantle hospital", "FH"],
  ["graylands neuropsychiatric", "Graylands"],
  ["king edward memorial hospital", "KEMH"],
  ["north metropolitan health service", "NMHS"],
  ["peel health campus", "PHC"],
  ["rockingham peel group", "RKPG"],
  ["royal perth bentley group", "RPBG"],
  ["south metropolitan health service", "SMHS"],
  ["wa health", "WA Health"],
]);

export const clinicalDocumentTagAliases = [
  { from: "a n c", to: "absolute neutrophil count" },
  { from: "absolute neutrophils", to: "absolute neutrophil count" },
  { from: "akg", to: "armadale kalamunda group" },
  { from: "clozapin", to: "clozapine" },
  { from: "clozapine monitering", to: "clozapine monitoring" },
  { from: "ctt", to: "clinical treatment team" },
  { from: "depot", to: "long acting injectable medication" },
  { from: "depot medication", to: "long acting injectable medication" },
  { from: "emhs", to: "east metropolitan health service" },
  { from: "emhs policy", to: "east metropolitan health service" },
  { from: "f b c", to: "full blood count" },
  { from: "fh", to: "fremantle hospital" },
  { from: "fsh", to: "fiona stanley hospital" },
  { from: "haematological monitoring", to: "hematological monitoring" },
  { from: "honos", to: "honos rating scale" },
  { from: "ho nos", to: "honos rating scale" },
  { from: "honosca", to: "honosca rating scale" },
  { from: "lai", to: "long acting injectable medication" },
  { from: "lai antipsychotic", to: "long acting injectable antipsychotic" },
  { from: "lithum", to: "lithium" },
  { from: "long acting injection", to: "long acting injectable medication" },
  { from: "long acting injections", to: "long acting injectable medication" },
  { from: "long acting injectable", to: "long acting injectable medication" },
  { from: "long acting injectables", to: "long acting injectable medication" },
  { from: "long acting injectable depot medication", to: "long acting injectable medication" },
  { from: "mhat", to: "mental health assessment team" },
  { from: "mhoa", to: "mental health older adult service" },
  { from: "nocc", to: "nocc outcome measures" },
  { from: "qtc", to: "qtc monitoring" },
  { from: "rkpg", to: "rockingham peel group" },
  { from: "smhs", to: "south metropolitan health service" },
  { from: "smhs policy", to: "south metropolitan health service" },
  { from: "wcc", to: "white cell count" },
] as const;

const lowValueExact = new Set([
  "administration",
  "administrative",
  "all rights reserved",
  "authorisation",
  "clinical guideline",
  "copyright",
  "document",
  "document control",
  "document owner",
  "documents",
  "file",
  "guidance",
  "guideline",
  "page",
  "pdf",
  "policy",
  "procedure",
  "protocol",
  "publication",
  "reference",
  "references",
  "review",
  "source",
  "table",
  "uncontrolled when printed",
  "version",
  "workflow",
]);

const lowValuePattern =
  /\b(?:uncontrolled when printed|document owner|document control|version control|copyright|all rights reserved|authorisation date|publication date|review date)\b/i;

function normalizedText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyClinicalAliases(value: string) {
  const exact = clinicalDocumentTagAliases.find((alias) => alias.from === value);
  if (exact) return exact.to;

  let aliased = value;
  for (const alias of clinicalDocumentTagAliases) {
    if (alias.from.length < 4) continue;
    aliased = aliased.replace(new RegExp(`\\b${alias.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), alias.to);
  }
  return aliased.replace(/\s+/g, " ").trim();
}

function canonicalLabel(value: string, labelType: DocumentLabelType) {
  const normalized = applyClinicalAliases(normalizedText(value));
  if (!normalized) return "";

  if (labelType === "document_type") {
    if (normalized === "assessment tool" || normalized === "assessment tools") return "assessment_tool";
    if (normalized === "prescribing aid" || normalized === "medication chart") return "prescribing_aid";
    if (normalized === "standard operating procedure") return "procedure";
    if (normalized === "fact sheet" || normalized === "information sheet") return "factsheet";
    if (
      [
        "policy",
        "guideline",
        "procedure",
        "protocol",
        "form",
        "checklist",
        "pathway",
        "reference",
        "algorithm",
        "factsheet",
        "manual",
      ].includes(normalized)
    ) {
      return normalized;
    }
  }

  if (labelType === "topic" && (normalized === "ect" || normalized === "electroconvulsive therapy")) {
    return "electroconvulsive-therapy";
  }
  if (normalized === "long acting injectable" || normalized === "long acting injectables") {
    return "long acting injectable medication";
  }
  if (normalized === "depot" || normalized === "depot medication") return "long acting injectable medication";
  if (normalized === "risk and safety" || normalized === "safety risk") return "risk escalation";
  if (normalized === "escalation pathway") return "escalation pathway";
  if (normalized === "metabolic") return "metabolic monitoring";
  if (normalized === "blood test" || normalized === "blood tests") return "blood test monitoring";
  if (normalized === "dose" || normalized === "dosing") return "dose adjustment";
  if (normalized === "documentation" && labelType !== "document_type") return "documentation requirements";
  if (normalized === "form" || normalized === "forms") return "clinical form";
  if (normalized === "checklist") return "clinical checklist";
  if (normalized === "role" || normalized === "roles" || normalized === "responsibilities") {
    return "roles and responsibilities";
  }

  return normalized;
}

function usefulTokenCount(value: string) {
  return value.split(/\s+/).filter((token) => token.length > 2 || acronymDisplay.has(token)).length;
}

// Audit L16: the function's default is an unconditional `return false`, so
// any label surviving the noisy checks is kept. The former document_type/site
// "protection" branches also returned false and were behaviorally dead code
// that misled maintainers into thinking those labels had protection a future
// noisy rule would silently bypass. If a rule must never apply to protected
// labels, short-circuit it ABOVE the noisy checks instead.
function isNoisyLabel(label: string, labelType: DocumentLabelType) {
  void labelType;
  if (!label || label.length < 2 || label.length > 64) return true;
  if (lowValuePattern.test(label)) return true;
  if (/\b(?:docx?|xlsx?|pptx?|pdf)\b/.test(label)) return true;
  if (
    labelType === "document_type" &&
    /^(?:policy|guideline|procedure|protocol|form|checklist|pathway|reference|algorithm|factsheet|manual|assessment_tool|prescribing_aid)$/.test(
      label,
    )
  ) {
    return false;
  }
  if (labelType === "clinical_action" && clinicalActionLabels.has(label)) return false;
  if (lowValueExact.has(label)) return true;
  if (usefulTokenCount(label) === 0) return true;
  if (label.split(/\s+/).length > 6) return true;
  return false;
}

function confidenceValue(value: unknown) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.55;
}

function labelTypeValue(value: unknown): DocumentLabelType {
  return labelTypes.has(value as DocumentLabelType) ? (value as DocumentLabelType) : "custom";
}

function sourceValue(value: unknown): DocumentLabel["source"] {
  return value === "manual" ? "manual" : "generated";
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function documentLabelReviewStatus(
  label: Pick<DocumentLabel, "metadata"> | { metadata?: unknown } | null | undefined,
): DocumentLabelReviewStatus {
  const metadata = metadataRecord(label?.metadata);
  const reviewStatus = String(metadata.review_status ?? metadata.label_review_status ?? "new");
  if (reviewStatus === "approved") return "approved";
  if (reviewStatus === "hidden" || metadata.hidden === true) return "hidden";
  return "new";
}

export function documentLabelTier(label: string, labelType: DocumentLabelType): SmartDocumentTagTier {
  const normalized = normalizedText(label);
  if (rankingOnlyLabels.has(normalized)) return "ranking";
  if (primaryLabelTypes.has(labelType)) return "primary";
  if (labelType === "content_feature" || labelType === "document_type" || labelType === "custom") return "secondary";
  return "secondary";
}

export function formatDocumentLabelDisplay(value: string, labelType?: DocumentLabelType) {
  const displayValue = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (labelType === "site") {
    const siteShortLabel = siteShortLabels.get(displayValue);
    if (siteShortLabel) return siteShortLabel;
  }
  const override = labelDisplayOverrides.get(value) ?? labelDisplayOverrides.get(displayValue);
  if (override) return override;

  return displayValue
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      const acronym = acronymDisplay.get(word);
      if (acronym) return acronym;
      if (index > 0 && lowercaseDisplayWords.has(word)) return word;
      return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
    })
    .join(" ");
}

function queryTerms(query?: string) {
  return new Set(
    normalizedText(query ?? "")
      .split(/\s+/)
      .filter((term) => term.length >= 3),
  );
}

function queryMatches(label: string, terms: Set<string>) {
  if (terms.size === 0) return false;
  return [...terms].some((term) => label.includes(term));
}

function clinicalValueBoost(label: string, labelType: DocumentLabelType) {
  let boost = 0;
  if (labelType === "site") boost += 0.14;
  if (/\b(?:clozapine|lithium|antipsychotic|medication|dose|fbc|anc|qtc|ect|lai)\b/.test(label)) boost += 0.18;
  if (/\b(?:risk|escalation|safety|urgent|toxicity|suicide|violence|duress)\b/.test(label)) boost += 0.16;
  if (/\b(?:monitoring|threshold|pathway|workflow|admission|discharge|review|follow up)\b/.test(label)) boost += 0.12;
  if (
    /^(?:clinical risk|mental health|inpatient|assessment|monitoring|physical health care|admission waitlist bed access)$/.test(
      label.replace(/[_-]+/g, " "),
    )
  ) {
    boost -= 0.3;
  }
  if (labelType === "clinical_action" || labelType === "care_phase" || labelType === "document_intent") boost += 0.08;
  if (labelType === "content_feature") boost -= 0.02;
  if (labelType === "document_type") boost -= 0.08;
  if (labelType === "custom") boost -= 0.05;
  return boost;
}

export function normalizeDocumentLabelForStorage(candidate: LabelCandidate): NormalizedDocumentLabel | null {
  const labelType = labelTypeValue(candidate.label_type);
  const confidence = confidenceValue(candidate.confidence);
  const source = sourceValue(candidate.source);
  const canonical = canonicalLabel(String(candidate.label ?? ""), labelType);

  if (source !== "manual" && confidence < 0.5) return null;
  if (source !== "manual" && isNoisyLabel(canonical, labelType)) return null;
  if (!canonical) return null;

  return {
    label: canonical,
    label_type: labelType,
    confidence,
  };
}

export function buildSmartDocumentTags(
  labels: Array<Pick<DocumentLabel, "label" | "label_type" | "source" | "confidence" | "metadata">> | null | undefined,
  options: { limit?: number; query?: string; includeManualGroup?: boolean; includeRanking?: boolean } = {},
) {
  const terms = queryTerms(options.query);
  const deduped = new Map<string, SmartDocumentTag>();

  for (const label of labels ?? []) {
    const normalized = normalizeDocumentLabelForStorage(label);
    const source = sourceValue(label.source);
    if (!normalized) continue;
    const reviewStatus = documentLabelReviewStatus(label);
    if (reviewStatus === "hidden") continue;
    const tier = documentLabelTier(normalized.label, normalized.label_type);
    if (tier === "ranking" && !options.includeRanking) continue;

    const group = options.includeManualGroup && source === "manual" ? "Manual" : groupLabels[normalized.label_type];
    const matched = queryMatches(normalized.label, terms);
    const score =
      (source === "manual" ? 1 : 0) +
      normalized.confidence +
      clinicalValueBoost(normalized.label, normalized.label_type) +
      (matched ? 1.5 : 0) -
      groupRank[group] * 0.04;
    const tag: SmartDocumentTag = {
      key: `${normalized.label_type}:${normalized.label}`,
      label: formatDocumentLabelDisplay(normalized.label, normalized.label_type),
      searchText: normalized.label,
      label_type: normalized.label_type,
      group,
      tier,
      reviewStatus,
      source,
      confidence: normalized.confidence,
      score,
      queryMatched: matched,
    };
    const existing = deduped.get(tag.searchText);
    if (!existing || tag.score > existing.score) deduped.set(tag.searchText, tag);
  }

  const sorted = [...deduped.values()].sort(
    (a, b) =>
      Number(b.queryMatched) - Number(a.queryMatched) ||
      groupRank[a.group] - groupRank[b.group] ||
      b.score - a.score ||
      a.label.localeCompare(b.label),
  );

  return typeof options.limit === "number" ? sorted.slice(0, Math.max(0, options.limit)) : sorted;
}

export function groupSmartDocumentTagsFromTags(tags: SmartDocumentTag[]): SmartDocumentTagGroupResult[] {
  const grouped = new Map<SmartDocumentTagGroup, SmartDocumentTag[]>();
  for (const tag of tags) {
    grouped.set(tag.group, [...(grouped.get(tag.group) ?? []), tag]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => groupRank[left] - groupRank[right])
    .map(([group, groupTags]) => ({ group, tags: groupTags }));
}

export function tagSearchText(labels: ClinicalTagSource | null | undefined) {
  return buildSmartDocumentTags(labels?.labels, { includeRanking: true })
    .map((tag) => `${tag.label} ${tag.searchText} ${tag.group}`)
    .join(" ");
}

function addQualityIssue(
  issues: SmartDocumentTagQualityIssue[],
  issue: Omit<SmartDocumentTagQualityIssue, "examples" | "documentTitles"> & {
    examples?: string[];
    documentTitles?: string[];
  },
) {
  issues.push({
    ...issue,
    examples: Array.from(new Set(issue.examples ?? [])).slice(0, 4),
    documentTitles: Array.from(new Set(issue.documentTitles ?? [])).slice(0, 4),
  });
}

export function reviewDocumentTagQuality<
  T extends ClinicalTagSource & { id?: string; title?: string; file_name?: string },
>(documents: T[], options: { lowConfidenceThreshold?: number; overusedThreshold?: number } = {}) {
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? 0.5;
  const overusedThreshold = options.overusedThreshold ?? Math.max(4, Math.ceil(documents.length * 0.25));
  const issues: SmartDocumentTagQualityIssue[] = [];
  const globalUsage = new Map<
    string,
    {
      label: string;
      canonicalLabel: string;
      label_type: DocumentLabelType;
      documents: Set<string>;
      examples: Set<string>;
    }
  >();

  for (const document of documents) {
    const title = document.title ?? document.file_name ?? document.id ?? "Untitled document";
    const perDocument = new Map<string, DocumentLabel[]>();

    for (const label of document.labels ?? []) {
      if (documentLabelReviewStatus(label as Pick<DocumentLabel, "metadata">) === "hidden") continue;
      const confidence = confidenceValue(label.confidence);
      const canonical = normalizeDocumentLabelForStorage({
        label: label.label,
        label_type: label.label_type,
        confidence: 1,
        source: "generated",
      });
      if (!canonical) {
        addQualityIssue(issues, {
          kind: "noisy",
          label: String(label.label ?? ""),
          label_type: label.label_type,
          count: 1,
          reason: "Would be dropped by smart-tag cleanup.",
          examples: [String(label.label ?? "")],
          documentTitles: [title],
        });
        continue;
      }

      if (label.source !== "manual" && confidence < lowConfidenceThreshold) {
        addQualityIssue(issues, {
          kind: "low_confidence",
          label: formatDocumentLabelDisplay(canonical.label),
          canonicalLabel: canonical.label,
          label_type: canonical.label_type,
          count: 1,
          reason: `${Math.round(confidence * 100)}% confidence is below the ${Math.round(lowConfidenceThreshold * 100)}% threshold.`,
          examples: [String(label.label ?? "")],
          documentTitles: [title],
        });
      }

      const duplicateKey = `${canonical.label_type}:${canonical.label}`;
      perDocument.set(duplicateKey, [...(perDocument.get(duplicateKey) ?? []), label as DocumentLabel]);

      const global = globalUsage.get(duplicateKey) ?? {
        label: formatDocumentLabelDisplay(canonical.label),
        canonicalLabel: canonical.label,
        label_type: canonical.label_type,
        documents: new Set<string>(),
        examples: new Set<string>(),
      };
      global.documents.add(title);
      global.examples.add(String(label.label ?? ""));
      globalUsage.set(duplicateKey, global);
    }

    for (const [key, duplicates] of perDocument) {
      const uniqueRaw = new Set(duplicates.map((label) => normalizedText(String(label.label ?? ""))));
      if (duplicates.length < 2 || uniqueRaw.size < 2) continue;
      const [labelType, canonicalLabel] = key.split(":") as [DocumentLabelType, string];
      addQualityIssue(issues, {
        kind: "duplicate",
        label: formatDocumentLabelDisplay(canonicalLabel),
        canonicalLabel,
        label_type: labelType,
        count: duplicates.length,
        reason: "Multiple near-equivalent tags exist on the same document.",
        examples: duplicates.map((label) => label.label),
        documentTitles: [title],
      });
    }
  }

  for (const global of globalUsage.values()) {
    if (global.documents.size < overusedThreshold) continue;
    addQualityIssue(issues, {
      kind: "overused",
      label: global.label,
      canonicalLabel: global.canonicalLabel,
      label_type: global.label_type,
      count: global.documents.size,
      reason: `Appears on ${global.documents.size} loaded documents; check whether it is too broad.`,
      examples: [...global.examples],
      documentTitles: [...global.documents],
    });
  }

  const rank: Record<SmartDocumentTagQualityIssueKind, number> = {
    noisy: 0,
    duplicate: 1,
    low_confidence: 2,
    overused: 3,
  };
  return issues.sort((a, b) => rank[a.kind] - rank[b.kind] || b.count - a.count || a.label.localeCompare(b.label));
}

export function buildSmartDocumentTagFacets<T extends ClinicalTagSource>(
  documents: T[],
  options: { query?: string; limitPerGroup?: number } = {},
) {
  return buildSmartDocumentTagFacetIndex(documents, options).groups;
}

export function buildSmartDocumentTagFacetIndex<T extends ClinicalTagSource>(
  documents: T[],
  options: { query?: string; limitPerGroup?: number } = {},
): SmartDocumentTagFacetIndex<T> {
  const limitPerGroup = options.limitPerGroup ?? 8;
  const allowedGroups = new Set(smartDocumentFacetGroups);
  const facets = new Map<string, SmartDocumentTagFacet>();
  const entries: SmartDocumentTagFacetIndex<T>["entries"] = [];

  for (const document of documents) {
    const documentTagKeys = new Set<string>();
    const tags = buildSmartDocumentTags(document.labels, { query: options.query, includeManualGroup: false });
    for (const tag of tags) {
      if (!allowedGroups.has(tag.group) || documentTagKeys.has(tag.key)) continue;
      documentTagKeys.add(tag.key);
      const existing = facets.get(tag.key);
      if (existing) {
        existing.count += 1;
      } else {
        facets.set(tag.key, {
          key: tag.key,
          label: tag.label,
          searchText: tag.searchText,
          group: tag.group,
          count: 1,
        });
      }
    }
    entries.push({ document, tagKeys: documentTagKeys, tags });
  }

  const groups = smartDocumentFacetGroups
    .map((group) => ({
      group,
      facets: [...facets.values()]
        .filter((facet) => facet.group === group)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, Math.max(1, limitPerGroup)),
    }))
    .filter((group) => group.facets.length > 0);

  return { entries, groups };
}

/**
 * Re-count an already-built facet index against the facets currently selected.
 *
 * `buildSmartDocumentTagFacetIndex` counts every facet across the whole match
 * set, which is correct only while nothing is selected. Selections AND together
 * (see `filterDocumentsBySmartTagFacetIndex`), so the moment one is applied the
 * built-in counts describe a set the reader is no longer looking at — and some
 * of them point at combinations that yield nothing, which reads as a live option
 * and behaves as a dead end.
 *
 * Each count here answers the question the row actually poses: *how many
 * documents would I have if I ticked this as well?* A facet that is already
 * selected reports the current result count, because that is what it is
 * currently giving you.
 *
 * Membership and order are deliberately left alone. Re-sorting by the new counts
 * would make rows jump under the pointer as you select, and re-slicing to the
 * top N could drop a facet you have already ticked. A facet whose count falls to
 * zero stays in place at zero so the caller can disable it: removing it makes
 * the list jump and hides the reason it went away.
 */
export function projectSmartTagFacetGroups<T extends ClinicalTagSource>(
  index: SmartDocumentTagFacetIndex<T>,
  selectedTagKeys: string[],
): SmartDocumentTagFacetGroup[] {
  const selected = [...new Set(selectedTagKeys)];
  if (selected.length === 0) return index.groups;

  const selectedKeys = new Set(selected);
  const keyGroups = facetKeyGroups(index);
  const byGroup = partitionSelectionByGroup(selected, keyGroups);
  const selectionCount = index.entries.filter((entry) => entryMatchesSelection(entry.tagKeys, byGroup)).length;

  // The count must be produced by the same predicate as the filter, or the two
  // drift apart the moment the combination rules change. Adding a key to a group
  // that is already selected *widens* under OR-within-group, so this cannot be
  // computed by narrowing an already-filtered subset.
  const countWith = (key: string) => {
    if (selectedKeys.has(key)) return selectionCount;
    const probe = partitionSelectionByGroup([...selected, key], keyGroups);
    return index.entries.filter((entry) => entryMatchesSelection(entry.tagKeys, probe)).length;
  };

  return index.groups.map((group) => ({
    group: group.group,
    facets: group.facets.map((facet) => ({ ...facet, count: countWith(facet.key) })),
  }));
}

export function filterDocumentsBySmartTagFacets<T extends ClinicalTagSource>(
  documents: T[],
  selectedTagKeys: string[],
) {
  return filterDocumentsBySmartTagFacetIndex(buildSmartDocumentTagFacetIndex(documents), selectedTagKeys);
}

/**
 * Which group each selectable key belongs to, read off the tags the index already
 * carries. `index.groups` is not a safe source: it is sliced to `limitPerGroup`,
 * so a key that is selected but outside the top N of its group would be missing.
 */
function facetKeyGroups<T extends ClinicalTagSource>(index: SmartDocumentTagFacetIndex<T>) {
  const groups = new Map<string, SmartDocumentTagGroup>();
  for (const entry of index.entries) {
    for (const tag of entry.tags) {
      if (!groups.has(tag.key)) groups.set(tag.key, tag.group);
    }
  }
  return groups;
}

/**
 * Group the selection so it can be combined the way a reader means it.
 *
 * Two values from the *same* group are alternatives — "Lithium or Clozapine",
 * "renal or thyroid risk" — so they widen. Values from *different* groups are
 * constraints that stack — "lithium documents, about renal risk" — so they
 * narrow. That is OR within a group, AND across groups.
 *
 * Before this, everything ANDed: picking two medications asked for a document
 * about both and returned nothing almost every time, which made multi-select
 * within a group a dead affordance rather than a feature.
 */
function partitionSelectionByGroup(selectedTagKeys: string[], keyGroups: Map<string, SmartDocumentTagGroup>) {
  const byGroup = new Map<string, Set<string>>();
  for (const key of new Set(selectedTagKeys)) {
    // A key whose group cannot be resolved is kept under its own identity, so it
    // still constrains rather than being silently dropped from the filter.
    const group = keyGroups.get(key) ?? `\u0000${key}`;
    const bucket = byGroup.get(group);
    if (bucket) bucket.add(key);
    else byGroup.set(group, new Set([key]));
  }
  return byGroup;
}

function entryMatchesSelection(tagKeys: Set<string>, byGroup: Map<string, Set<string>>) {
  for (const keys of byGroup.values()) {
    let hit = false;
    for (const key of keys) {
      if (tagKeys.has(key)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

export function filterDocumentsBySmartTagFacetIndex<T extends ClinicalTagSource>(
  index: SmartDocumentTagFacetIndex<T>,
  selectedTagKeys: string[],
) {
  if (selectedTagKeys.length === 0) return index.entries.map((entry) => entry.document);
  const byGroup = partitionSelectionByGroup(selectedTagKeys, facetKeyGroups(index));
  return index.entries.filter((entry) => entryMatchesSelection(entry.tagKeys, byGroup)).map((entry) => entry.document);
}

type ClinicalTagSource = {
  labels?: Array<Pick<DocumentLabel, "label" | "label_type" | "source" | "confidence" | "metadata">> | null;
};
