import { allocateOnCallGroupSlug } from "@/components/on-call/on-call-page-anchors";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { compareOnCallTeams, onCallTeamBarLabel } from "@/lib/on-call/handbook-title";

/**
 * Call's Hospital tab, by department (owner card "Call by department"; v6
 * figure 05). The hospital's numbers come from the handbook's published
 * `contacts`, filed by the title prefix editors write (plan correction C7):
 *
 *  1. **Emergency** — `Emergency:` rows, first, so the emergency route is never
 *     below the fold.
 *  2. **One group per department** — any prefix that is not a category is a
 *     team (`ICU: Registrar`), in `ON_CALL_TEAMS` order, then by name.
 *  3. **Wards** — `Ward:` rows. A ward's title names no department, so it
 *     keeps its own group rather than being guessed into one.
 *  4. **General** — everything else: Switchboard first, then by label. This is
 *     where an untitled prefix, `Access:`, `Equipment:` and `Downtime:` numbers
 *     land, so no number is ever dropped.
 *
 * Slugs never collide with the page's own anchors (`hospital`, `external`,
 * `mine`), so a department called "External" still has its own id.
 */
export type OnCallCallGroup = {
  readonly slug: string;
  readonly label: string;
  /** The one word the quick-jump chip shows. */
  readonly chip: string;
  readonly kind: "emergency" | "department" | "wards" | "general";
  readonly items: readonly HandbookItem[];
};

const RESERVED_SLUGS = ["hospital", "external", "mine"];

const isSwitchboard = (item: HandbookItem) => item.parsed.label.toLowerCase() === "switchboard";

/** The hospital's Switchboard row, the fallback every "Didn't connect" sheet offers. */
export function onCallSwitchboardItem(items: readonly HandbookItem[]): HandbookItem | null {
  return (
    items.find(
      (item) =>
        item.section === "contacts" &&
        item.parsed.prefix === null &&
        item.parsed.team === null &&
        isSwitchboard(item) &&
        item.dial.kind !== "none",
    ) ?? null
  );
}

const byLabel = (a: HandbookItem, b: HandbookItem) =>
  a.parsed.label.localeCompare(b.parsed.label) || a.id.localeCompare(b.id);

export function onCallCallGroups(items: readonly HandbookItem[]): OnCallCallGroup[] {
  const contacts = items.filter((item) => item.section === "contacts");
  const emergency: HandbookItem[] = [];
  const wards: HandbookItem[] = [];
  const general: HandbookItem[] = [];
  const teams = new Map<string, HandbookItem[]>();
  for (const item of contacts) {
    if (item.parsed.prefix === "Emergency") emergency.push(item);
    else if (item.parsed.prefix === "Ward") wards.push(item);
    else if (item.parsed.team) teams.set(item.parsed.team, [...(teams.get(item.parsed.team) ?? []), item]);
    else general.push(item);
  }

  const taken = new Set<string>(RESERVED_SLUGS);
  const groups: OnCallCallGroup[] = [];
  const push = (label: string, chip: string, kind: OnCallCallGroup["kind"], rows: HandbookItem[]) => {
    if (rows.length === 0) return;
    groups.push({ slug: allocateOnCallGroupSlug(label, taken), label, chip, kind, items: rows });
  };

  push("Emergency", "Emergency", "emergency", [...emergency].sort(byLabel));
  for (const team of [...teams.keys()].sort(compareOnCallTeams)) {
    push(team, onCallTeamBarLabel(team), "department", [...(teams.get(team) ?? [])].sort(byLabel));
  }
  push("Wards", "Wards", "wards", [...wards].sort(byLabel));
  push(
    "General",
    "General",
    "general",
    [...general].sort((a, b) => Number(isSwitchboard(b)) - Number(isSwitchboard(a)) || byLabel(a, b)),
  );
  return groups;
}

/** The short role names the mock-up draws in a row's badge, read from the role word that starts a label. */
const ROLE_BADGES: Readonly<Record<string, string>> = {
  registrar: "REG",
  consultant: "CON",
  resident: "RES",
  intern: "INT",
};

/**
 * A row's short badge (REG, CON, W2, 4B), or null when its label carries none.
 * It is read from the label only, never guessed: a role badge when the label
 * starts with one of the four grades, a ward badge when a `Ward:` row names a
 * ward by a short code ("Ward 2" → W2, "Synthetic ward 4B" → 4B).
 */
export function onCallRowBadge(item: HandbookItem): string | null {
  const label = item.parsed.label.trim();
  if (item.parsed.prefix === "Ward") {
    const ward = /\bward\s+([0-9]{1,2}[A-Za-z]?|[A-Za-z][0-9]{1,2})\b/i.exec(label)?.[1];
    if (!ward) return null;
    return /^\d+$/.test(ward) ? `W${ward}` : ward.toUpperCase();
  }
  const first = /^([A-Za-z]+)\b/.exec(label)?.[1]?.toLowerCase();
  return first ? (ROLE_BADGES[first] ?? null) : null;
}
