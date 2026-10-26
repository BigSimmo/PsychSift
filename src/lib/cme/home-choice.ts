import { CME_PRESET_SOURCES, CME_PRESET_VERSION, createAustralianRanzcpPreset } from "@/lib/cme/presets";
import type { CmeRequirementSet } from "@/lib/cme/types";

export type CpdHomeKind = "national" | "ranzcp" | "other";
export type CpdHomeChoice = { kind: CpdHomeKind; name: string; guide: string };

const RANZCP_PRESET_ID = /^au-ranzcp-\d{4}-v\d+\b/;
const NATIONAL_SOURCE = /^CPD home: National baseline only\r?\nSource checked: (.+)$/;
const OTHER_SOURCE = /^CPD home: Other — ([^\r\n]+)\r?\nSource checked: (.+)$/;
export const NATIONAL_GUIDE = CME_PRESET_SOURCES[0].url;
export const RANZCP_GUIDE = CME_PRESET_SOURCES.map((source) => source.url).join("; ");

/** An explicit home marker plus the actual guide the owner checked, kept readable in exports. */
export function confirmedSourceForHome(choice: CpdHomeChoice): string {
  const guide = choice.guide.trim();
  if (choice.kind === "ranzcp") return `${CME_PRESET_VERSION}; ${guide}`;
  if (choice.kind === "national") return `CPD home: National baseline only\nSource checked: ${guide}`;
  return `CPD home: Other — ${choice.name.trim()}\nSource checked: ${guide}`;
}

/** Legacy custom sources remain editable as Other without guessing a college name. */
export function readCpdHome(source: string): CpdHomeChoice {
  const trimmed = source.trim();
  if (RANZCP_PRESET_ID.test(trimmed)) {
    return { kind: "ranzcp", name: "RANZCP", guide: trimmed.replace(RANZCP_PRESET_ID, "").replace(/^;\s*/, "") };
  }
  const national = NATIONAL_SOURCE.exec(trimmed);
  if (national) return { kind: "national", name: "", guide: national[1] };
  const other = OTHER_SOURCE.exec(trimmed);
  if (other) return { kind: "other", name: other[1], guide: other[2] };
  return { kind: "other", name: "", guide: trimmed };
}

export function isRanzcpHome(source: string): boolean {
  return RANZCP_PRESET_ID.test(source.trim());
}

/** Every doctor starts from the national rows; only RANZCP adds its available college preset. */
export function requirementsForCpdHome(
  kind: CpdHomeKind,
  year: number,
  confirmedOn: string,
): Pick<CmeRequirementSet, "year" | "confirmedOn" | "totalHours" | "requirements"> {
  const preset = createAustralianRanzcpPreset(year, confirmedOn);
  return kind === "ranzcp"
    ? preset
    : { ...preset, requirements: preset.requirements.filter((requirement) => requirement.source === "national") };
}

/**
 * The targets after the owner picks another CPD home while editing a year. Going back
 * to the home the year was confirmed under brings back its confirmed targets (total
 * and any college extras), not a fresh preset. And a task already recorded as done
 * (plan written, self-evaluation) keeps its date across every switch, so looking at
 * another home and coming back never quietly reopens it.
 */
export function requirementsAfterHomeChange(
  current: Pick<CmeRequirementSet, "confirmedOn" | "requirements">,
  kind: CpdHomeKind,
  year: number,
  saved: CmeRequirementSet | null,
): Pick<CmeRequirementSet, "year" | "confirmedOn" | "totalHours" | "requirements"> {
  const base =
    saved && saved.year === year && readCpdHome(saved.confirmedSource).kind === kind
      ? { year, confirmedOn: current.confirmedOn, totalHours: saved.totalHours, requirements: saved.requirements }
      : requirementsForCpdHome(kind, year, current.confirmedOn);
  return {
    ...base,
    requirements: base.requirements.map((requirement) => {
      if (requirement.spec.shape !== "task") return requirement;
      const before = current.requirements.find((item) => item.id === requirement.id && item.spec.shape === "task");
      return before ? { ...requirement, completedOn: before.completedOn } : requirement;
    }),
  };
}
