import { isDifferentialMetadataArtifactTitle } from "@/lib/differential-snapshot";
import type {
  DifferentialComparisonCandidate,
  DifferentialComparisonCriterion,
  DifferentialMapNode,
  DifferentialPresentationWorkflow,
  DifferentialRecord,
  DifferentialRedFlagFlow,
  DifferentialScenarioPreset,
  DifferentialSection,
  DifferentialSnapshot,
} from "@/lib/differential-snapshot";

export type ParsedOption = {
  slug: string;
  name: string;
  summary: string;
  redFlags: string[];
};

export type ParsedPresentation = {
  entryId: string;
  slug: string;
  title: string;
  status: "emergent" | "urgent" | "routine";
  axis: "organic" | "primary-psychiatric" | "mixed";
  population: string;
  triageRationale: string;
  mustNotMiss: string[];
  mimics: string[];
  clinicalHinge: string;
  immediateActions: string[];
  investigations: string[];
  options: ParsedOption[];
  source: string;
  tags: string[];
};

/**
 * Criteria the export writes per diagnosis. Everything else on a presentation is
 * written about the group, so it is derived once and labelled
 * `scope: "presentation"` rather than repeated as each diagnosis's own answer.
 * See {@link DifferentialTextScope} and
 * `tests/differentials-presentation-scope.test.ts`.
 */
const DIAGNOSIS_SCOPED_CRITERIA = new Set(["why-it-fits", "must-not-miss"]);

const COMPARISON_CRITERIA: DifferentialComparisonCriterion[] = (
  [
    { id: "why-it-fits", title: "Why it fits", tone: "fit" },
    { id: "what-argues-against", title: "What argues against", tone: "overlap" },
    { id: "must-not-miss", title: "Must-not-miss", tone: "warning" },
    { id: "bedside-question", title: "Bedside question", tone: "question" },
    { id: "immediate-action", title: "Immediate action", tone: "action" },
    { id: "investigations", title: "Investigations", tone: "test" },
    { id: "mimics-overlap", title: "Mimics / overlap", tone: "overlap" },
  ] satisfies Omit<DifferentialComparisonCriterion, "scope">[]
).map((criterion) => ({
  ...criterion,
  scope: DIAGNOSIS_SCOPED_CRITERIA.has(criterion.id) ? ("diagnosis" as const) : ("presentation" as const),
}));

const PRESENTATION_SLUG_OVERRIDES: Record<string, string> = {
  "1": "acute-confusion-encephalopathy",
};

const OPTION_SLUG_OVERRIDES: Record<string, string> = {
  delirium: "delirium",
  "substance intoxication": "substance-intoxication",
  "substance withdrawal": "substance-withdrawal",
  "post-ictal state": "post-ictal-confusion",
  "post-ictal confusion": "post-ictal-confusion",
  "post-ictal state / seizure-related confusion": "post-ictal-confusion",
  "wernicke encephalopathy": "wernicke-encephalopathy",
  "hepatic encephalopathy": "hepatic-encephalopathy",
  "meningitis / encephalitis": "meningitis-encephalitis",
  "meningitis encephalitis": "meningitis-encephalitis",
  pneumonia: "pneumonia",
  "thyroid disease": "thyroid-disease",
};

const URGENCY_RANK: Record<DifferentialRecord["status"], number> = {
  emergent: 3,
  urgent: 2,
  routine: 1,
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function optionSlug(name: string) {
  const fullKey = normalizeKey(name.split("—")[0]?.split("–")[0]?.trim() ?? name);
  const key = normalizeKey(name.split("/")[0]?.split("—")[0]?.split("–")[0]?.trim() ?? name);
  return OPTION_SLUG_OVERRIDES[fullKey] ?? OPTION_SLUG_OVERRIDES[key] ?? slugify(fullKey);
}

function mapUrgency(raw: string): DifferentialRecord["status"] {
  const normalized = raw.trim().toLowerCase().split(/\r?\n/)[0].trim();
  if (normalized.startsWith("emergent")) return "emergent";
  if (normalized.startsWith("urgent")) return "urgent";
  if (normalized.startsWith("standard") || normalized.startsWith("routine")) return "routine";
  return "routine";
}

function splitSection(content: string, label: string) {
  const pattern = new RegExp(`^${label}:\\s*`, "im");
  const match = content.match(pattern);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeader = rest.search(/\n[A-Z][A-Z /&-]+:\s*\n|\nOPTIONS:\s*\n|\nSOURCE:\s*\n/);
  return (nextHeader >= 0 ? rest.slice(0, nextHeader) : rest).trim();
}

function bulletItems(section: string) {
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
}

function splitNameSummary(line: string): { name: string; summary: string; redFlags: string[] } {
  const cleaned = line.replace(/^\d+\.\s*/, "").trim();
  // Split on em/en dash or spaced hyphen — not inside words, so names like "Post-ictal confusion" stay intact.
  const dashMatch = cleaned.match(/^(.+?)\s*(?:—|–|\s-\s)\s*(.+)$/);
  const name = (dashMatch?.[1] ?? cleaned).trim();
  let remainder = (dashMatch?.[2] ?? "").trim();
  let redFlags: string[] = [];
  const redFlagMatch = remainder.match(/(?:Red flags?:)\s*(.+)$/i);
  if (redFlagMatch) {
    redFlags = redFlagMatch[1]
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    remainder = remainder
      .slice(0, redFlagMatch.index)
      .trim()
      .replace(/\.\s*$/, "");
  }
  return { name, summary: remainder, redFlags };
}

function parseEntryHeader(content: string) {
  const headerMatch = content.match(/^===\s*(.+?)\s*===\s*\n/m);
  const header = headerMatch?.[1]?.trim() ?? "";
  const entryMatch = header.match(/ENTRY\s+(\d+[A-Z]?)/i);
  if (entryMatch) return entryMatch[1]!.toUpperCase();
  const appendixMatch = header.match(/APPENDIX\s+([A-Z0-9]+)/i);
  if (appendixMatch) return `A${appendixMatch[1]}`;
  if (/trap/i.test(header)) return "TRAP";
  return header ? slugify(header) : "unknown";
}

// ALL-CAPS "=== HEADER ===" text to a human title, e.g.
// "FOCUSED DIAGNOSTIC TRAP TABLES" -> "Focused Diagnostic Trap Tables".
function titleFromHeader(header: string) {
  return header.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseEntryTitle(content: string) {
  const header = content.match(/^===\s*(.+?)\s*===\s*\n/m)?.[1]?.trim() ?? "";
  const afterHeader = content.replace(/^===\s*.+?\s*===\s*\n/m, "");
  const firstLine = afterHeader
    .split("\n")
    .find((line) => line.trim())
    ?.trim();
  // Most entries put a title on the line after the header. The focused
  // diagnostic trap-tables appendix has none, so the first line is actually a
  // metadata row ("Urgency: urgent") — fall back to the header text so the
  // entry gets an honest title instead of surfacing the metadata as its title.
  if (firstLine && !isDifferentialMetadataArtifactTitle(firstLine)) return firstLine;
  return header ? titleFromHeader(header) : (firstLine ?? "Untitled presentation");
}

function parseOptionsSection(content: string): ParsedOption[] {
  const optionsBlock = splitSection(content, "OPTIONS");
  if (!optionsBlock) return [];
  return optionsBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\./.test(line))
    .map((line) => {
      const parsed = splitNameSummary(line);
      return {
        slug: optionSlug(parsed.name),
        name: parsed.name,
        summary: parsed.summary,
        redFlags: parsed.redFlags,
      };
    });
}

export function parseEntryFile(content: string, fileName?: string): ParsedPresentation {
  const entryIdFromFile = fileName?.match(/^(\d+)/)?.[1] ?? "";
  const entryId = parseEntryHeader(content) || entryIdFromFile || "unknown";
  const title = parseEntryTitle(content);
  const slug = PRESENTATION_SLUG_OVERRIDES[entryId] ?? slugify(title);
  const status = mapUrgency(splitSection(content, "Urgency") || "routine");
  const axisRaw = splitSection(content, "Axis").toLowerCase();
  const axis: ParsedPresentation["axis"] = axisRaw.includes("organic")
    ? "organic"
    : axisRaw.includes("psych")
      ? "primary-psychiatric"
      : "mixed";
  const population = splitSection(content, "Population") || "general";
  const triageRationale = splitSection(content, "TRIAGE RATIONALE") || splitSection(content, "PURPOSE") || title;
  const mustNotMissRaw = splitSection(content, "MUST NOT MISS");
  const mustNotMiss = mustNotMissRaw.includes("\n")
    ? bulletItems(mustNotMissRaw)
    : mustNotMissRaw
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const mimicsRaw = splitSection(content, "MIMICS");
  const mimics = mimicsRaw.includes("\n")
    ? bulletItems(mimicsRaw)
    : mimicsRaw
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const clinicalHinge = splitSection(content, "CLINICAL HINGE") || triageRationale;
  const immediateActions = bulletItems(splitSection(content, "IMMEDIATE ACTIONS"));
  const investigations = bulletItems(splitSection(content, "INVESTIGATIONS"));
  const options = parseOptionsSection(content);
  const source = splitSection(content, "SOURCE") || `Entry ${entryId}`;

  return {
    entryId,
    slug,
    title,
    status,
    axis,
    population,
    triageRationale,
    mustNotMiss,
    mimics,
    clinicalHinge,
    immediateActions,
    investigations,
    options,
    source,
    tags: [axis, population, status].filter(Boolean),
  };
}

function selectedCandidateCount(total: number) {
  if (total <= 3) return total;
  return Math.min(6, Math.max(3, Math.ceil(total * 0.45)));
}

function buildCandidateComparison(option: ParsedOption, presentation: ParsedPresentation): Record<string, string> {
  return {
    "why-it-fits": option.summary || option.name,
    "what-argues-against": presentation.mimics.slice(0, 2).join("; ") || "Review locally.",
    "must-not-miss":
      option.redFlags.join(", ") || presentation.mustNotMiss.slice(0, 3).join(", ") || "Review must-not-miss causes.",
    "bedside-question": presentation.clinicalHinge || "Assess clinical hinge.",
    "immediate-action":
      presentation.immediateActions.length > 0
        ? presentation.immediateActions
            .slice(0, 2)
            .map((item) => item.trim().replace(/\.+$/, ""))
            .filter(Boolean)
            .join(", ") + "."
        : "Stabilise and reassess.",
    investigations: presentation.investigations.slice(0, 6).join(", ") || "Guided by presentation.",
    "mimics-overlap": presentation.mimics.slice(0, 4).join(", ") || "Review overlap locally.",
  };
}

function buildPresentationWorkflow(parsed: ParsedPresentation): DifferentialPresentationWorkflow {
  const selectedCount = selectedCandidateCount(parsed.options.length);
  const candidates: DifferentialComparisonCandidate[] = parsed.options.map((option, index) => ({
    slug: option.slug,
    selected: index < selectedCount,
    comparison: buildCandidateComparison(option, parsed),
  }));

  return {
    id: parsed.slug,
    title: parsed.title,
    status: parsed.status,
    subtitle: parsed.triageRationale,
    selectedCount,
    totalCount: parsed.options.length,
    safetySnapshot: {
      summary: parsed.clinicalHinge || parsed.triageRationale || parsed.title,
      tags: parsed.mustNotMiss.slice(0, 4).length ? parsed.mustNotMiss.slice(0, 4) : ["Review must-not-miss causes"],
    },
    criteria: COMPARISON_CRITERIA,
    candidates,
    reviewChecklist: [
      "Stabilise and rule out immediate threats",
      "Assess for reversible causes",
      "Investigate and treat precipitants",
      "Reassess and refine differential",
      "Document and handoff",
    ],
    highestUrgencyNote: "Safety first. Act early.",
    sourceStatus: {
      label: "Source pending review",
      version: "v10 | Local content only",
      lastUpdated: "Pending review",
    },
  };
}

function diagnosisSections(option: ParsedOption, presentation: ParsedPresentation): DifferentialSection[] {
  const redFlagsAreOwn = option.redFlags.length > 0;
  const immediateSummary =
    presentation.immediateActions.length > 0
      ? presentation.immediateActions
          .map((item) => item.trim().replace(/\.+$/, ""))
          .filter(Boolean)
          .join(", ") + "."
      : "Stabilise and reassess.";

  return [
    {
      id: "why-it-fits",
      title: "Why it fits",
      summary: option.summary || option.name,
      // The presentation hinge deliberately does NOT join these items. It
      // describes the group, so listing it here read as evidence for this
      // diagnosis. It stays available as the scoped bedside-question section.
      items: [option.summary || option.name].filter(Boolean),
      tone: "fit",
      scope: "diagnosis",
    },
    {
      id: "must-not-miss",
      title: "Must-not-miss",
      summary: redFlagsAreOwn
        ? option.redFlags.join(", ")
        : presentation.mustNotMiss.join(", ") || "Review must-not-miss causes.",
      items: redFlagsAreOwn
        ? option.redFlags
        : presentation.mustNotMiss.length > 0
          ? presentation.mustNotMiss
          : ["Review must-not-miss causes."],
      tone: "warning",
      scope: redFlagsAreOwn ? "diagnosis" : "presentation",
    },
    {
      id: "bedside-question",
      title: "Bedside question",
      summary: presentation.clinicalHinge || "Assess clinical hinge.",
      items: [presentation.clinicalHinge || "Assess clinical hinge."].filter(Boolean),
      tone: "question",
      scope: "presentation",
    },
    {
      id: "immediate-action",
      title: "Immediate action",
      summary: immediateSummary,
      items: presentation.immediateActions.length > 0 ? presentation.immediateActions : ["Stabilise and reassess."],
      tone: "action",
      scope: "presentation",
    },
    {
      id: "investigations",
      title: "Investigations",
      summary: presentation.investigations.join(", ") || "Guided by presentation.",
      items: presentation.investigations.length > 0 ? presentation.investigations : ["Guided by presentation."],
      tone: "test",
      scope: "presentation",
    },
    {
      id: "mimics-overlap",
      title: "Mimics / overlap",
      summary: presentation.mimics.join(", ") || "Review overlap locally.",
      items: presentation.mimics.length > 0 ? presentation.mimics : ["Review overlap locally."],
      tone: "overlap",
      scope: "presentation",
    },
  ];
}

function buildDiagnosisRecord(option: ParsedOption, presentation: ParsedPresentation): DifferentialRecord {
  return {
    slug: option.slug,
    title: option.name.split("/")[0]?.trim() || option.name,
    status: presentation.status,
    subtitle: option.summary || presentation.triageRationale,
    clinicalHinge: presentation.clinicalHinge,
    clinicalHingeScope: "presentation",
    safetySnapshot: {
      // Never falls back to the presentation hinge: that put the akathisia
      // discriminator in acute dystonia's safety summary.
      summary: option.redFlags.join(", "),
      tags: option.redFlags.slice(0, 4),
    },
    sections: diagnosisSections(option, presentation),
    related: presentation.options
      .filter((candidate) => candidate.slug !== option.slug)
      .slice(0, 6)
      .map((candidate) => ({
        id: candidate.slug,
        label: candidate.name.split("/")[0]?.trim() || candidate.name,
        likelihood: "possible" as const,
        note: candidate.summary,
      })),
    currentPresentation: [presentation.title, ...presentation.mustNotMiss.slice(0, 2)],
    investigations: presentation.investigations,
    immediateActions: presentation.immediateActions,
  };
}

function isFallbackText(text: string): boolean {
  const normalized = text.trim().replace(/\.+$/, "");
  return [
    "Review must-not-miss causes",
    "Assess clinical hinge",
    "Stabilise and reassess",
    "Guided by presentation",
    "Review overlap locally",
    "Review clinical details",
  ].includes(normalized);
}

function mergeDiagnosisRecords(existing: DifferentialRecord, incoming: DifferentialRecord): DifferentialRecord {
  const preferIncoming = URGENCY_RANK[incoming.status] >= URGENCY_RANK[existing.status];
  const primary = preferIncoming ? incoming : existing;
  const secondary = preferIncoming ? existing : incoming;

  const mergeText = (left: string, right: string) => {
    if (!left.trim()) return right;
    if (!right.trim()) return left;
    return left.length >= right.length ? left : right;
  };

  const mergeSectionSummaryText = (left: string, right: string) => {
    if (!left.trim()) return right;
    if (!right.trim()) return left;
    const leftIsFallback = isFallbackText(left);
    const rightIsFallback = isFallbackText(right);
    if (leftIsFallback && !rightIsFallback) return right;
    if (!leftIsFallback && rightIsFallback) return left;
    return left.length >= right.length ? left : right;
  };

  const unionItems = (left: string[], right: string[]) => [...new Set([...left, ...right].filter(Boolean))];

  const mergeSectionItemsList = (left: string[], right: string[]) => {
    const leftNonFallback = left.filter((item) => !isFallbackText(item));
    const rightNonFallback = right.filter((item) => !isFallbackText(item));
    const combinedNonFallback = unionItems(leftNonFallback, rightNonFallback);
    if (combinedNonFallback.length > 0) {
      return combinedNonFallback.slice(0, 8);
    }
    return unionItems(left, right).slice(0, 8);
  };

  return {
    ...primary,
    subtitle: mergeText(primary.subtitle, secondary.subtitle),
    clinicalHinge: mergeText(primary.clinicalHinge, secondary.clinicalHinge),
    safetySnapshot: {
      summary: mergeText(primary.safetySnapshot.summary, secondary.safetySnapshot.summary),
      tags: unionItems(primary.safetySnapshot.tags, secondary.safetySnapshot.tags).slice(0, 6),
    },
    sections: [
      ...primary.sections.map((section: DifferentialSection) => {
        const other = secondary.sections.find((candidate) => candidate.id === section.id);
        const mergedSummary = mergeSectionSummaryText(section.summary, other?.summary ?? "");
        const mergedItems = mergeSectionItemsList(section.items, other?.items ?? []);
        const fallback =
          section.id === "why-it-fits"
            ? primary.title
            : section.id === "must-not-miss"
              ? "Review must-not-miss causes."
              : section.id === "bedside-question"
                ? "Assess clinical hinge."
                : section.id === "immediate-action"
                  ? "Stabilise and reassess."
                  : section.id === "investigations"
                    ? "Guided by presentation."
                    : section.id === "mimics-overlap"
                      ? "Review overlap locally."
                      : "Review clinical details.";
        const nonFallbackItems = mergedItems.filter((item) => !isFallbackText(item));
        let finalSummary = mergedSummary;
        if (!finalSummary || isFallbackText(finalSummary)) {
          if (nonFallbackItems.length > 0) {
            finalSummary =
              section.id === "immediate-action"
                ? nonFallbackItems
                    .map((item) => item.trim().replace(/\.+$/, ""))
                    .filter(Boolean)
                    .join(", ") + "."
                : nonFallbackItems.join(", ");
          } else {
            finalSummary = finalSummary || fallback;
          }
        }
        return {
          ...section,
          summary: finalSummary,
          items: mergedItems.length > 0 ? mergedItems : [fallback],
        };
      }),
      ...secondary.sections.filter((s) => !primary.sections.some((p) => p.id === s.id)),
    ],
    investigations: unionItems(primary.investigations, secondary.investigations),
    immediateActions: unionItems(primary.immediateActions, secondary.immediateActions),
    related: unionItems(
      primary.related.map((node: DifferentialMapNode) => node.id),
      secondary.related.map((node: DifferentialMapNode) => node.id),
    )
      .map(
        (id) =>
          primary.related.find((node: DifferentialMapNode) => node.id === id) ??
          secondary.related.find((node: DifferentialMapNode) => node.id === id),
      )
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .slice(0, 8),
    currentPresentation: unionItems(primary.currentPresentation, secondary.currentPresentation).slice(0, 6),
  };
}

// Splitting on "## " leaves any document preamble (the top-level "# Title"
// heading and intro prose) as a phantom first section; it must be dropped or
// it becomes a bogus record (e.g. a "# Scenario Presets" preset).
function markdownSections(markdown: string) {
  const sections = markdown.split(/(?:^|\n)##\s+/).filter(Boolean);
  return markdown.trimStart().startsWith("## ") ? sections : sections.slice(1);
}

export function parseScenarioPresets(markdown: string): DifferentialScenarioPreset[] {
  const sections = markdownSections(markdown);
  return sections.map((section, index) => {
    const lines = section.split("\n");
    const titleLine = lines[0]?.trim() ?? `Preset ${index + 1}`;
    const query = section.match(/\*\*Query:\*\*\s*`([^`]+)`/)?.[1]?.trim() ?? titleLine;
    const signals =
      section
        .match(/\*\*Signals:\*\*\s*(.+)/)?.[1]
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    const entryIds =
      section
        .match(/\*\*Entries:\*\*([\s\S]*?)(?:\n##|\n---|$)/)?.[1]
        ?.split("\n")
        .map((line) => line.match(/Entry\s+(\d+[A-Z]?)/i)?.[1]?.toUpperCase())
        .filter((value): value is string => Boolean(value)) ?? [];
    const presentationSlugs = entryIds.map((entryId) => PRESENTATION_SLUG_OVERRIDES[entryId] ?? slugify(entryId));
    return {
      id: slugify(titleLine),
      query,
      signals,
      entryIds,
      presentationSlugs,
    };
  });
}

export function parseRedFlagFlows(markdown: string): DifferentialRedFlagFlow[] {
  const sections = markdownSections(markdown);
  return sections.map((section, index) => {
    const title = section.split("\n")[0]?.trim() ?? `Flow ${index + 1}`;
    const entryId = section.match(/Entry\s+(\d+[A-Z]?)/i)?.[1]?.toUpperCase() ?? "";
    const presentationSlug = PRESENTATION_SLUG_OVERRIDES[entryId] ?? slugify(entryId || title);
    const bedsideQuestions =
      section.match(/\*\*Bedside questions:\*\*\s*(.+)/)?.[1]?.trim() ??
      section.match(/Bedside questions:\*\*\s*(.+)/)?.[1]?.trim() ??
      "";
    const keyRedFlags =
      section.match(/\*\*Key red flags across options:\*\*\s*(.+)/)?.[1]?.trim() ??
      section.match(/Key red flags across options:\*\*\s*(.+)/)?.[1]?.trim() ??
      "";
    return {
      id: slugify(title),
      title,
      entryId,
      presentationSlug,
      bedsideQuestions,
      keyRedFlags,
    };
  });
}

export function parseSearchAliases(markdown: string): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match || match[1]?.includes("Token") || match[1]?.includes("---")) continue;
    const token = match[1].trim().toLowerCase();
    const values = match[2]
      .split(",")
      .map((item) => item.trim().toLowerCase())
      // The export also carries field-weight tables (e.g. "| tags | 1.1 |");
      // bare numbers are ranking weights, not clinical synonyms.
      .filter((item) => Boolean(item) && !/^\d+(\.\d+)?$/.test(item));
    if (token && values.length) aliases[token] = values;
  }
  return aliases;
}

function parseGovernance(markdown: string) {
  const version = markdown.match(/\|\s*Version\s*\|\s*([^|]+?)\s*\|/)?.[1]?.trim() ?? "v10";
  const reviewStatus = markdown.match(/\|\s*Review status\s*\|\s*([^|]+?)\s*\|/)?.[1]?.trim() ?? "Pending review";
  const sourceTitle = markdown.match(/\|\s*Source title\s*\|\s*([^|]+?)\s*\|/)?.[1]?.trim() ?? "Differentials";
  return { version, reviewStatus, sourceTitle };
}

export function buildDifferentialSnapshot(input: {
  entryFiles: Array<{ name: string; content: string }>;
  tagIndexMarkdown?: string;
  presetsMarkdown: string;
  flowsMarkdown: string;
  aliasesMarkdown: string;
  governanceMarkdown: string;
}): DifferentialSnapshot {
  const parsedPresentations = input.entryFiles.map(({ name, content }) => parseEntryFile(content, pathBasename(name)));
  const presentations = parsedPresentations.map(buildPresentationWorkflow);

  const diagnosisMap = new Map<string, DifferentialRecord>();
  for (const parsed of parsedPresentations) {
    for (const option of parsed.options) {
      const record = buildDiagnosisRecord(option, parsed);
      const existing = diagnosisMap.get(record.slug);
      diagnosisMap.set(record.slug, existing ? mergeDiagnosisRecords(existing, record) : record);
    }
  }

  return {
    version: parseGovernance(input.governanceMarkdown).version,
    exportedAt: new Date().toISOString().slice(0, 10),
    presentations,
    diagnoses: [...diagnosisMap.values()].sort((left, right) => left.title.localeCompare(right.title)),
    presets: parseScenarioPresets(input.presetsMarkdown),
    redFlagFlows: parseRedFlagFlows(input.flowsMarkdown),
    searchAliases: parseSearchAliases(input.aliasesMarkdown),
    governance: parseGovernance(input.governanceMarkdown),
  };
}

function pathBasename(value: string) {
  return value.split(/[/\\]/).pop() ?? value;
}
