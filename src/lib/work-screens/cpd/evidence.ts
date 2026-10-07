import { activeCmeYearEntries } from "@/lib/cme/export";
import { cmeCategories, cmeCertificateMissing, type CmeCategory, type CmeEntry } from "@/lib/cme/types";

/*
 * CPD Evidence (`/cme/evidence`, mock-up cpd_evidence): which of the year's activities have evidence
 * attached and which still need it, from the counts the CPD loaders already read for every activity
 * (`evidenceCount`, `certificateCount`). No file names are read here: listing every file across a year
 * needs an endpoint that does not exist yet, so each file stays on its own activity.
 *
 * "Needs evidence" is the log's own rule (`cmeCertificateMissing`): the certificates were counted and
 * there are none. An activity whose evidence was not counted says nothing rather than guessing.
 */

export type EvidenceCategoryFilter = "all" | CmeCategory;
export type EvidenceStatusFilter = "all" | "missing" | "attached";
export type EvidenceOrder = "newest" | "oldest";

export const EVIDENCE_CATEGORY_FILTERS: readonly { id: EvidenceCategoryFilter; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "educational", label: "Educational" },
  { id: "reviewing", label: "Reviewing" },
  { id: "measuring", label: "Outcomes" },
];

export const EVIDENCE_STATUS_FILTERS: readonly { id: EvidenceStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "missing", label: "Needs evidence" },
  { id: "attached", label: "Has evidence" },
];

/** Short category words for a row's grey line, as the CPD log writes them. */
export const EVIDENCE_CATEGORY_WORDS: Record<CmeCategory, string> = {
  educational: "Educational",
  reviewing: "Reviewing",
  measuring: "Outcomes",
};

export function parseEvidenceCategory(value: string | null | undefined): EvidenceCategoryFilter {
  return value && (cmeCategories as readonly string[]).includes(value) ? (value as CmeCategory) : "all";
}

export function parseEvidenceStatus(value: string | null | undefined): EvidenceStatusFilter {
  return value === "missing" || value === "attached" ? value : "all";
}

export function parseEvidenceOrder(value: string | null | undefined): EvidenceOrder {
  return value === "oldest" ? "oldest" : "newest";
}

export type EvidenceRowState = "missing" | "attached" | "unknown";

export interface EvidenceRow {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly categories: readonly CmeCategory[];
  readonly hours: number;
  /** Evidence files on the activity, certificates included. Null when they were not counted. */
  readonly files: number | null;
  readonly state: EvidenceRowState;
  /** Where the activity's evidence is added: the activity page, at its evidence section. */
  readonly href: string;
}

export interface EvidenceView {
  /** Active activities in the year, archived left out. */
  readonly total: number;
  readonly attached: number;
  readonly missing: number;
  /** Activities whose evidence was not counted (the sample), so no claim is made either way. */
  readonly unknown: number;
  /** Rows matching the type filter only, before the status filter, for the chips' counts. */
  readonly typeCounts: Record<EvidenceStatusFilter, number>;
  readonly needs: readonly EvidenceRow[];
  readonly has: readonly EvidenceRow[];
  readonly notCounted: readonly EvidenceRow[];
}

export const EVIDENCE_ANCHOR = "cme-evidence-heading";

export function evidenceEntryHref(id: string): string {
  return `/cme/log/${encodeURIComponent(id)}#${EVIDENCE_ANCHOR}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function evidenceRowState(entry: CmeEntry): EvidenceRowState {
  if (cmeCertificateMissing(entry)) return "missing";
  if ((entry.evidenceCount ?? 0) > 0 || (entry.certificateCount ?? 0) > 0) return "attached";
  return "unknown";
}

function toRow(entry: CmeEntry): EvidenceRow {
  const present = new Set(entry.allocations.map((a) => a.category));
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    categories: cmeCategories.filter((c) => present.has(c)),
    hours: round2(entry.allocations.reduce((sum, a) => sum + a.hours, 0)),
    // A certificate is an evidence file, so a counted certificate is never "0 files".
    files: entry.evidenceCount === undefined ? null : Math.max(entry.evidenceCount, entry.certificateCount ?? 0),
    state: evidenceRowState(entry),
    href: evidenceEntryHref(entry.id),
  };
}

export function evidenceView(
  entries: readonly CmeEntry[],
  year: number,
  filters: { category: EvidenceCategoryFilter; status: EvidenceStatusFilter; order: EvidenceOrder },
): EvidenceView {
  const active = activeCmeYearEntries(entries, year).map(toRow);
  const ofType = active.filter((row) => filters.category === "all" || row.categories.includes(filters.category));
  const sorted = [...ofType].sort((a, b) =>
    filters.order === "oldest"
      ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
      : b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
  const shown = (state: EvidenceRowState) =>
    sorted.filter((row) => row.state === state && (filters.status === "all" || statusMatches(filters.status, state)));
  return {
    total: active.length,
    attached: active.filter((row) => row.state === "attached").length,
    missing: active.filter((row) => row.state === "missing").length,
    unknown: active.filter((row) => row.state === "unknown").length,
    typeCounts: {
      all: ofType.length,
      missing: ofType.filter((row) => row.state === "missing").length,
      attached: ofType.filter((row) => row.state === "attached").length,
    },
    needs: shown("missing"),
    has: shown("attached"),
    notCounted: filters.status === "all" ? shown("unknown") : [],
  };
}

function statusMatches(filter: Exclude<EvidenceStatusFilter, "all">, state: EvidenceRowState): boolean {
  return filter === state;
}

/**
 * "Educational · 1 h", or "Educational and Reviewing · 2.5 h". An activity that needs evidence but
 * already holds other files says so ("· 2 files, no certificate"), so its Attach is not a puzzle.
 */
export function evidenceRowLine(row: EvidenceRow): string {
  const words = row.categories.map((c) => EVIDENCE_CATEGORY_WORDS[c]);
  const kind = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "No hours");
  const line = `${kind} · ${row.hours} h`;
  return row.state === "missing" && row.files ? `${line} · ${fileCountWords(row.files)}, no certificate` : line;
}

/**
 * The empty state under "Needs evidence". "Every activity has evidence" is said only when every
 * activity was counted: an activity whose evidence was not counted (the demo, the sample) is never
 * claimed as covered.
 */
export function needsEvidenceEmpty(view: EvidenceView, filtered: boolean): { title: string; body?: string } {
  if (view.unknown > 0) {
    return {
      title: "None known to need evidence",
      body:
        view.unknown === 1
          ? "Evidence was not counted for 1 activity. Open it to check."
          : `Evidence was not counted for ${view.unknown} activities. Open each to check.`,
    };
  }
  if (filtered) return { title: "Nothing here needs evidence", body: "Try another type to see the rest." };
  return { title: "Every activity has evidence" };
}

/** "1 file", "3 files". */
export function fileCountWords(files: number | null): string {
  if (files === null) return "Not counted";
  return files === 1 ? "1 file" : `${files} files`;
}

/**
 * Where the dock's "Attach evidence" goes: straight to the one activity, or to the list when several
 * need it. `clearFilters` says the filters hide every activity that needs evidence, so the list is shown
 * unfiltered rather than landing on "Nothing here needs evidence".
 */
export function attachTarget(
  view: EvidenceView,
): { kind: "entry"; href: string } | { kind: "list"; clearFilters: boolean } | null {
  if (view.missing === 0) return null;
  if (view.needs.length === 1) return { kind: "entry", href: view.needs[0]!.href };
  return { kind: "list", clearFilters: view.needs.length === 0 };
}

/** The year page's own address with its filters, so Back and a shared link keep them. */
export function evidenceHref(params: {
  year?: number | null;
  category?: EvidenceCategoryFilter;
  status?: EvidenceStatusFilter;
  order?: EvidenceOrder;
}): string {
  const search = new URLSearchParams();
  if (params.year) search.set("year", String(params.year));
  if (params.category && params.category !== "all") search.set("category", params.category);
  if (params.status && params.status !== "all") search.set("show", params.status);
  if (params.order === "oldest") search.set("order", "oldest");
  const query = search.toString();
  return query ? `/cme/evidence?${query}` : "/cme/evidence";
}

/** Month and day for the date tile: "Sep", "22". */
export function dateTile(date: string): { month: string; day: number } {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, month, day] = date.split("-");
  return { month: months[Number.parseInt(month ?? "1", 10) - 1] ?? "", day: Number.parseInt(day ?? "1", 10) };
}
