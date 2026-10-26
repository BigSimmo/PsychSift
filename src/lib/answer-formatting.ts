import type { AnswerResponseMode } from "@/lib/types";

export type AnswerDisplayLine = {
  id: string;
  label: string | null;
  displayLabel: string | null;
  text: string;
  presentation: AnswerLinePresentation;
  group: AnswerDisplayGroup;
  explicitLabel: boolean;
  isLead: boolean;
};

export type AnswerDisplayGroup =
  | "bottom_line"
  | "action"
  | "monitoring"
  | "medication"
  | "escalation"
  | "documentation"
  | "comparison"
  | "source"
  | "gap"
  | "summary";

export type AnswerDisplayTone =
  | "direct"
  | "action"
  | "monitoring"
  | "medication"
  | "risk"
  | "documentation"
  | "gap"
  | "comparison"
  | "source"
  | "summary";

export type AnswerLinePresentation = {
  tone: AnswerDisplayTone;
  symbol: string;
  label: string;
};

export type AnswerDisplayMode =
  | "direct"
  | "checklist"
  | "clinical_pathway"
  | "comparison"
  | "comparison_matrix"
  | "threshold_table"
  | "document_lookup"
  | "summary"
  | "evidence_gap";

export type AnswerDisplayGroupSummary = {
  group: AnswerDisplayGroup;
  label: string;
  lines: AnswerDisplayLine[];
};

export type ParsedAnswerDisplay =
  | {
      type: "paragraph";
      lines: AnswerDisplayLine[];
      lead: AnswerDisplayLine | null;
      groups: AnswerDisplayGroupSummary[];
      mode: AnswerDisplayMode;
    }
  | {
      type: "bullets";
      lines: AnswerDisplayLine[];
      lead: AnswerDisplayLine | null;
      groups: AnswerDisplayGroupSummary[];
      mode: AnswerDisplayMode;
    };

const groupLabels: Record<AnswerDisplayGroup, string> = {
  bottom_line: "Bottom line",
  action: "Action",
  monitoring: "Monitoring",
  medication: "Medication",
  escalation: "Escalation",
  documentation: "Document",
  comparison: "Compare",
  source: "Source",
  gap: "Source gap",
  summary: "Summary",
};

const groupSymbols: Record<AnswerDisplayGroup, string> = {
  bottom_line: "✓",
  action: "→",
  monitoring: "⏱",
  medication: "Rx",
  escalation: "!",
  documentation: "§",
  comparison: "↔",
  source: "#",
  gap: "?",
  summary: "•",
};

const groupTones: Record<AnswerDisplayGroup, AnswerDisplayTone> = {
  bottom_line: "direct",
  action: "action",
  monitoring: "monitoring",
  medication: "medication",
  escalation: "risk",
  documentation: "documentation",
  comparison: "comparison",
  source: "source",
  gap: "gap",
  summary: "summary",
};
const answerFormatFallbackText = "No usable answer text.";

const highSignalGroups = new Set<AnswerDisplayGroup>([
  "bottom_line",
  "action",
  "monitoring",
  "medication",
  "escalation",
  "documentation",
  "comparison",
  "source",
  "gap",
]);

const knownAnswerLabels = new Map<string, AnswerDisplayGroup>([
  ["answer", "bottom_line"],
  ["bottom line", "bottom_line"],
  ["clinical point", "bottom_line"],
  ["direct answer", "bottom_line"],
  ["key point", "bottom_line"],
  ["required action", "action"],
  ["required actions", "action"],
  ["action", "action"],
  ["actions", "action"],
  ["workflow step", "action"],
  ["next step", "action"],
  ["monitoring", "monitoring"],
  ["monitoring/timing", "monitoring"],
  ["timing", "monitoring"],
  ["table evidence", "monitoring"],
  ["threshold/action", "monitoring"],
  ["threshold", "monitoring"],
  ["thresholds", "monitoring"],
  ["dose detail", "medication"],
  ["dose details", "medication"],
  ["medication point", "medication"],
  ["medication/dose details", "medication"],
  ["medication/dose detail", "medication"],
  ["medication details", "medication"],
  ["dose", "medication"],
  ["risk/escalation", "escalation"],
  ["escalation/risk", "escalation"],
  ["escalation", "escalation"],
  ["risk", "escalation"],
  ["safety", "escalation"],
  ["documentation/forms", "documentation"],
  ["documentation", "documentation"],
  ["forms", "documentation"],
  ["document", "documentation"],
  ["comparison", "comparison"],
  ["compare", "comparison"],
  ["source point", "source"],
  ["source", "source"],
  ["source evidence", "source"],
  ["citation", "source"],
  ["quote", "source"],
  ["source gaps", "gap"],
  ["source gap", "gap"],
  ["gap", "gap"],
  ["unsupported", "gap"],
  ["section summary", "summary"],
  ["summary", "summary"],
]);

function normalizeInline(value: string) {
  return value.replace(/[ \t]+/g, " ").trim();
}

function stripBulletPrefix(value: string) {
  return value.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
}

const bulletPrefixPattern = /^(?:[-*•]|\d+[.)])\s+/;

function mergeBulletContinuations(lines: string[]) {
  const merged: string[] = [];
  let current = "";

  for (const line of lines) {
    if (bulletPrefixPattern.test(line)) {
      if (current) merged.push(current);
      current = stripBulletPrefix(line);
      continue;
    }

    if (current) {
      current = `${current} ${line}`.trim();
    } else {
      merged.push(line);
    }
  }

  if (current) merged.push(current);
  return merged;
}

function splitBySemicolonList(value: string) {
  const semicolonCount = (value.match(/;/g) ?? []).length;
  if (semicolonCount < 2 || semicolonCount > 5) return [];
  if (value.length > 340) return [];

  const parts = value
    .split(/\s*;\s*/)
    .map((part) => normalizeInline(part))
    .filter((part) => part.length >= 24);

  if (parts.length < 3 || parts.length > 6) return [];

  const avgWordsPerPart = parts.reduce((sum, part) => sum + part.split(/\s+/).filter(Boolean).length, 0) / parts.length;
  if (avgWordsPerPart < 4) return [];

  return parts;
}

function splitInlineBullets(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const newlineParts = trimmed
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLineIndex = newlineParts.findIndex((line) => bulletPrefixPattern.test(line));
  if (newlineParts.filter((line) => bulletPrefixPattern.test(line)).length >= 2) {
    const lead = bulletLineIndex > 0 ? [newlineParts.slice(0, bulletLineIndex).join(" ")] : [];
    return [...lead, ...mergeBulletContinuations(newlineParts.slice(Math.max(0, bulletLineIndex)))];
  }

  // A spaced hyphen between two numbers is a range ("0.6 - 0.8 mmol/L"), not a bullet break;
  // splitting it left the Bottom line lead with the lower bound only and no unit.
  const inlineParts = trimmed
    .split(/(?:^|\s)-\s+(?=(?:\*\*)?[A-Z])|(?:^|(?<!\d(?:\*\*)?)\s)-\s+(?=(?:\*\*)?\d)/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (inlineParts.length >= 2) return inlineParts;

  return [trimmed];
}

function normalizeLabelKey(value: string) {
  return normalizeInline(value.replace(/\*\*/g, ""))
    .replace(/\s*\/\s*/g, "/")
    .toLowerCase();
}

function groupFromLabel(label: string | null): AnswerDisplayGroup | null {
  if (!label) return null;
  const labelKey = normalizeLabelKey(label);
  const exact = knownAnswerLabels.get(labelKey);
  if (exact) return exact;
  if (/\bbottom line\b/.test(labelKey)) return "bottom_line";
  if (/\b(?:source gaps?|gap|unsupported)\b/.test(labelKey)) return "gap";
  if (/\b(?:risk|escalation|red flag|safety)\b/.test(labelKey)) return "escalation";
  if (/\b(?:medication|dose|titration|prescrib(?:e|es|ed|er|ers|ing))\b/.test(labelKey)) return "medication";
  if (/\b(?:monitoring|timing|threshold|table evidence)\b/.test(labelKey)) return "monitoring";
  if (/\b(?:required actions?|workflow|action)\b/.test(labelKey)) return "action";
  if (/\b(?:documentation|forms?|record|audit)\b/.test(labelKey)) return "documentation";
  if (/\b(?:compare|comparison|conflict)\b/.test(labelKey)) return "comparison";
  if (/\b(?:source|citation|quote|evidence)\b/.test(labelKey)) return "source";
  if (/\b(?:summary|overview|section summary)\b/.test(labelKey)) return "summary";
  return null;
}

function groupFromText(text: string): AnswerDisplayGroup {
  const combined = text.toLowerCase();
  if (/\b(?:gap|insufficient|unsupported|not contain|not enough|unclear|missing)\b/.test(combined)) {
    return "gap";
  }
  if (
    /\b(?:risk|escalat(?:e|es|ed|ing|ion|ions)|urgent|immediate|red flag|cease|withhold|stop|contraindicat(?:e|es|ed|ion|ions)|avoid|emergency)\b/.test(
      combined,
    )
  ) {
    return "escalation";
  }
  if (
    /\b(?:monitor(?:ing)?|timing|weekly|monthly|hours?|days?|weeks?|anc|fbc|wbc|blood test|threshold|level)\b/.test(
      combined,
    )
  ) {
    return "monitoring";
  }
  if (
    /\b(?:dose|mg|mcg|route|oral|intramuscular|im\b|po\b|clozapine|lithium|lorazepam|haloperidol|olanzapine|medication)\b/.test(
      combined,
    )
  ) {
    return "medication";
  }
  if (/\b(?:document|form|record|audit|consent|register|file|note)\b/.test(combined)) {
    return "documentation";
  }
  if (/\b(?:compare|versus|difference|whereas|while|document-specific|conflict)\b/.test(combined)) {
    return "comparison";
  }
  if (/\b(?:source|citation|quote|evidence|excerpt)\b/.test(combined)) {
    return "source";
  }
  if (/\b(?:action|required|must|should|complete|refer|review|arrange|contact|notify|assess)\b/.test(combined)) {
    return "action";
  }
  if (/\b(?:summary|overview|bottom line|key point)\b/.test(combined)) {
    return "summary";
  }
  return "bottom_line";
}

function splitLabel(
  value: string,
): Pick<AnswerDisplayLine, "label" | "displayLabel" | "text" | "group" | "explicitLabel"> {
  const match = value.match(/^([^:]{2,44}):\s+(.+)$/);
  if (!match) {
    const group = groupFromText(value);
    return {
      label: null,
      displayLabel: highSignalGroups.has(group) ? groupLabels[group] : null,
      text: value,
      group,
      explicitLabel: false,
    };
  }

  const rawLabel = normalizeInline(match[1].replace(/\*\*/g, ""));
  const explicitGroup = groupFromLabel(rawLabel);
  if (!explicitGroup && !/^[A-Z][A-Za-z/ -]{2,40}$/.test(rawLabel)) {
    const group = groupFromText(value);
    return {
      label: null,
      displayLabel: highSignalGroups.has(group) ? groupLabels[group] : null,
      text: value,
      group,
      explicitLabel: false,
    };
  }
  const text = normalizeInline(match[2]);
  const group = explicitGroup ?? groupFromText(text);

  return {
    label: rawLabel,
    displayLabel: highSignalGroups.has(group) ? groupLabels[group] : null,
    text,
    group,
    explicitLabel: true,
  };
}

function presentationForGroup(group: AnswerDisplayGroup): AnswerLinePresentation {
  return { tone: groupTones[group], symbol: groupSymbols[group], label: groupLabels[group] };
}

function inferDisplayMode(lines: AnswerDisplayLine[]): AnswerDisplayMode {
  const presentations = lines.map((line) => line.presentation);
  if (presentations.some((item) => item.tone === "gap")) return "evidence_gap";
  if (presentations.some((item) => item.tone === "comparison")) return "comparison";
  if (presentations.some((item) => item.tone === "risk" || item.tone === "medication" || item.tone === "monitoring")) {
    return "clinical_pathway";
  }
  if (lines.length >= 2 && presentations.some((item) => item.tone === "action" || item.tone === "documentation")) {
    return "checklist";
  }
  if (lines.length >= 3) return "summary";
  return "direct";
}

export function coerceAnswerDisplayMode(
  responseMode?: AnswerResponseMode | AnswerDisplayMode | null,
  fallback: AnswerDisplayMode = "direct",
): AnswerDisplayMode {
  if (!responseMode) return fallback;
  if (
    responseMode === "checklist" ||
    responseMode === "comparison_matrix" ||
    responseMode === "threshold_table" ||
    responseMode === "clinical_pathway" ||
    responseMode === "document_lookup" ||
    responseMode === "evidence_gap"
  ) {
    return responseMode;
  }
  if (responseMode === "comparison") return "comparison_matrix";
  if (responseMode === "summary") return "summary";
  if (responseMode === "direct") return "direct";
  return fallback;
}

export function answerLinePresentation(line: AnswerDisplayLine): AnswerLinePresentation {
  return line.presentation ?? presentationForGroup(line.group);
}

function groupedLines(lines: AnswerDisplayLine[]): AnswerDisplayGroupSummary[] {
  const groups = new Map<AnswerDisplayGroup, AnswerDisplayLine[]>();
  for (const line of lines) {
    if (line.isLead && line.group === "bottom_line") continue;
    const existing = groups.get(line.group) ?? [];
    existing.push(line);
    groups.set(line.group, existing);
  }

  const order: AnswerDisplayGroup[] = [
    "bottom_line",
    "action",
    "monitoring",
    "medication",
    "escalation",
    "documentation",
    "comparison",
    "source",
    "gap",
    "summary",
  ];
  return order
    .filter((group) => groups.has(group))
    .map((group) => ({ group, label: groupLabels[group], lines: groups.get(group) ?? [] }));
}

function buildAnswerLine(part: string, index: number, prefix: string): AnswerDisplayLine {
  const parsed = splitLabel(part);
  const isLead = index === 0 && (!parsed.explicitLabel || parsed.group === "bottom_line");
  return {
    id: `${prefix}:${index}:${part.slice(0, 48)}`,
    ...parsed,
    isLead,
    presentation: presentationForGroup(parsed.group),
  };
}

function parsedAnswer(type: ParsedAnswerDisplay["type"], lines: AnswerDisplayLine[]): ParsedAnswerDisplay {
  const lead = lines.find((line) => line.isLead) ?? null;
  return {
    type,
    mode: inferDisplayMode(lines),
    lead,
    groups: groupedLines(lines),
    lines,
  };
}

export function parseAnswerDisplayContent(
  value: string,
  preferredMode?: AnswerResponseMode | AnswerDisplayMode | null,
): ParsedAnswerDisplay {
  const cleaned = value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) {
    return {
      type: "paragraph",
      mode: coerceAnswerDisplayMode(preferredMode, "evidence_gap"),
      lines: [
        {
          id: "empty",
          label: null,
          displayLabel: "Source gap",
          text: answerFormatFallbackText,
          group: "gap",
          explicitLabel: false,
          isLead: true,
          presentation: presentationForGroup("gap"),
        },
      ],
      lead: null,
      groups: [],
    };
  }

  const parts = splitInlineBullets(cleaned)
    .map((part) => normalizeInline(part))
    .filter((part) => part.length > 0);

  if (parts.length >= 2) {
    const lines = parts.map((part, index) => buildAnswerLine(part, index, "bullet"));
    const parsed = parsedAnswer("bullets", lines);
    return { ...parsed, mode: coerceAnswerDisplayMode(preferredMode, parsed.mode) };
  }

  const semicolonParts = splitBySemicolonList(cleaned);
  if (semicolonParts.length >= 3) {
    const lines = semicolonParts.map((part, index) => buildAnswerLine(part, index, "semicolon"));
    const parsed = parsedAnswer("bullets", lines);
    return { ...parsed, mode: coerceAnswerDisplayMode(preferredMode, parsed.mode) };
  }

  const lines = [buildAnswerLine(normalizeInline(cleaned), 0, "paragraph")];
  const parsed = parsedAnswer("paragraph", lines);
  return { ...parsed, mode: coerceAnswerDisplayMode(preferredMode, parsed.mode) };
}
