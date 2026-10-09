import { onCallDigitsOf } from "@/lib/on-call/entry-search";
import { ON_CALL_TEAMS, parseHandbookTitle } from "@/lib/on-call/handbook-title";
import type { ServiceContent, ServiceEntry } from "@/lib/on-call/service-model";

/**
 * What an editor sees while they type a handbook entry: where the row will
 * land once it is published, and anything worth a second look before they
 * save it.
 *
 * Handbook content has no category, team or placement field of its own
 * (plan correction C7) — the title's prefix is the only signal, parsed by
 * `parseHandbookTitle`. Everything here is advisory: nothing it returns
 * blocks a save (task 4.4), because a typo caught by a person who can see
 * the consequence is worth more than one this module silently guesses at.
 */

export type HandbookEditorWarningId =
  | "new-team"
  | "similar-team"
  | "emergency-no-site"
  | "emergency-not-clinical"
  | "emergency-pinned"
  | "number-length"
  | "number-shared";

export type HandbookEditorWarning = { readonly id: HandbookEditorWarningId; readonly text: string };

export type HandbookEditorContent = Pick<ServiceContent, "title" | "section" | "kind" | "siteId" | "phone">;

/** "Will appear in: Call, then Hospital, then Medicine", the one line the editor sees as they type. */
export function handbookPlacementLine(content: HandbookEditorContent): string {
  if (content.section === "playbook") return "Will appear in: Playbook after independent review";
  if (content.section === "cover")
    return "Will appear in: Who's on, Call and Your team during the recorded times after independent review";
  const parsed = parseHandbookTitle(content.title);
  if (parsed.prefix === "Emergency" && content.section === "contacts") {
    return "Will appear in: Now (emergency) and Call, then Hospital";
  }
  if (content.section === "contacts") {
    if (parsed.prefix === "Downtime") return "Will appear in: Find, then Systems down";
    if (parsed.prefix === "Access") return "Will appear in: Call, then Hospital";
    if (parsed.team) return `Will appear in: Call, then Hospital, then ${parsed.team}`;
    return "Will appear in: Call, then Hospital";
  }
  if (content.section === "referrals") return "Will appear in: Refer";
  if (content.section === "resources") {
    if (parsed.prefix === "Ward") return "Will appear in: Find, then Wards";
    if (parsed.prefix === "Equipment") return "Will appear in: Find, then Equipment";
    if (parsed.prefix === "Downtime") return "Will appear in: Find, then Systems down";
    return "Will appear in: Find, then Other";
  }
  return "Will appear in: Handbook";
}

/** Trim, lower-case, collapse internal whitespace — the one comparison every check below shares. */
function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Iterative Levenshtein distance, for "differs by at most two letters" (both names already short). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) distances[row]![0] = row;
  for (let col = 0; col < cols; col += 1) distances[0]![col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      distances[row]![col] = Math.min(
        distances[row - 1]![col]! + 1,
        distances[row]![col - 1]! + 1,
        distances[row - 1]![col - 1]! + cost,
      );
    }
  }
  return distances[rows - 1]![cols - 1]!;
}

/** Same team once case and spacing are ignored, or a near-miss typo of one (both names 4+ letters). */
function isSimilarTeam(a: string, b: string): boolean {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (left === right) return false; // an exact match is "used", not "similar" — the caller checks that first.
  if (left.length < 4 || right.length < 4) return false;
  return editDistance(left, right) <= 2;
}

export function handbookEditorWarnings(
  content: HandbookEditorContent,
  input: {
    readonly entries: readonly ServiceEntry[];
    readonly editingId: string | null;
    readonly siteName: string | null;
  },
): HandbookEditorWarning[] {
  const warnings: HandbookEditorWarning[] = [];
  const parsed = parseHandbookTitle(content.title);
  const others = input.entries.filter((entry) => entry.id !== input.editingId && entry.status !== "withdrawn");

  if (parsed.prefix === "Emergency") {
    if (!content.siteId) {
      warnings.push({
        id: "emergency-no-site",
        text: "An emergency number needs a site to be pinned on Now. Without one it shows on Call only.",
      });
    } else if (content.kind !== "clinical") {
      warnings.push({ id: "emergency-not-clinical", text: "Save it as clinical, with its source, to pin it on Now." });
    } else {
      warnings.push({
        id: "emergency-pinned",
        text: `This will be pinned as the emergency number at ${input.siteName ?? "this hospital"}.`,
      });
    }
  }

  if (parsed.team) {
    const team = parsed.team;
    const otherTeams = others
      .map((entry) => parseHandbookTitle(entry.content.title).team)
      .filter((value): value is string => Boolean(value));
    const usedExactly = otherTeams.some((other) => normalizeKey(other) === normalizeKey(team));
    if (!usedExactly) {
      const similarTo = otherTeams.find((other) => isSimilarTeam(team, other));
      if (similarTo) {
        warnings.push({
          id: "similar-team",
          text: `Is this the same team as "${similarTo}"? Teams group by exact name.`,
        });
      } else if (!(ON_CALL_TEAMS as readonly string[]).includes(team)) {
        warnings.push({ id: "new-team", text: `New team "${team}": it gets its own group on Call.` });
      }
    }
  }

  const mainNumber = content.phone.split(",")[0] ?? "";
  if (mainNumber.trim() && !mainNumber.trim().startsWith("+")) {
    const digits = onCallDigitsOf(mainNumber);
    if (digits.length === 7 || digits.length === 9 || digits.length >= 11) {
      warnings.push({
        id: "number-length",
        text: `This number has ${digits.length} digits. WA landlines have 8, or 10 with 08.`,
      });
    }
    if (digits.length > 0) {
      const clash = others.find(
        (entry) =>
          entry.content.siteId === content.siteId &&
          normalizeKey(entry.content.title) !== normalizeKey(content.title) &&
          onCallDigitsOf(entry.content.phone.split(",")[0] ?? "") === digits,
      );
      if (clash) {
        warnings.push({ id: "number-shared", text: `The same number is saved for "${clash.content.title}".` });
      }
    }
  }

  return warnings;
}
