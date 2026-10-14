import {
  BedDouble,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CircleHelp,
  CloudOff,
  FileText,
  Globe,
  UserRound,
  Wrench,
  OctagonAlert,
  Phone,
  Repeat,
  Shield,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import { onCallEntryGroups } from "@/components/on-call/on-call-entry-groups";
import { allocateOnCallGroupSlug, onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import type { OnCallPageView } from "@/components/on-call/on-call-section-identity";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { MODE_NAV_MIN_ITEMS } from "@/components/mode-nav/mode-nav-bands";
import { complianceConsequence, partitionLogisticsEntries } from "@/lib/on-call/compliance";
import { onCallTagFacet, type OnCallFacetReader } from "@/lib/on-call/entry-filters";
import {
  ON_CALL_COMPLIANCE_CONSEQUENCES,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallComplianceConsequence,
  type OnCallEntry,
} from "@/lib/on-call/entry-model";
import { isRoleExplainerEntry, partitionContactsEntries } from "@/lib/on-call/who-is-who";
import { compareOnCallTeams, onCallTeamBarLabel, type OnCallTeam } from "@/lib/on-call/handbook-title";

/**
 * The groups on an On Call page, for the in-page header's jump list.
 *
 * The mode's second row used to list the nine SECTIONS — which the mode pill
 * already opens, so two controls did one job while nothing helped a reader move
 * around the page in front of them. Contacts alone runs to six groups and
 * several screens. This is what that row lists instead.
 *
 * These are declarations, not the rendered truth: `useResolvedPageSections`
 * drops any whose anchor is not on the page, so a page with one group (or none)
 * simply shows a title and no disclosure. Teaching is that page: it has no
 * facet to file by, so it stays one flat list and the header stays a title.
 *
 * ## Where a grouping rule is shared rather than copied
 *
 * Contacts and Who's who keep their own copy of the rule the list renders by,
 * and that is safe because a DOM test asserts every anchor they DECLARE against
 * the page they RENDER. Admin, Compliance and Orientation have no such test
 * yet, and their keys are quieter than a tag: a fallback heading that reads
 * "Other" here and "General" there, or a band label one word apart, is not a
 * visible bug — it is a jump list row that does nothing. So those three export
 * their key from here (`onCallAdminCategoryLabel`,
 * `ON_CALL_COMPLIANCE_BANDS`, `onCallOrientationCategoryFacet`,
 * `sortOnCallEntries`) and the list components import them. The dependency runs
 * the safe way round: the list may read the declaration, never the reverse —
 * importing a list component here would make the header depend on the body it
 * sits above.
 */

/** A group heading a list component renders, and what it holds. */
type Group = { slug: string; label: string; count: number; icon: LucideIcon };

/**
 * ONE WORD PER LABEL. This is the convention the bar is calibrated for.
 *
 * `label` is drawn in a 48px row of bare words that truncate rather than fold
 * (`wordmark-five` in src/components/mode-nav/mode-nav-bands.ts). "What you can
 * authorise" measured 165px in that row against a 288px phone viewport and was
 * cut to "Authorise" — the measurement is recorded in
 * `tests/ui-on-call-boards.spec.ts` (board 11), and it is why every Admin
 * category, Orientation folder and Compliance band label is a single word. The
 * demo corpus models the same convention so the truncation cannot come back
 * unseen in a browser.
 *
 * A group whose full meaning genuinely needs a phrase keeps the phrase as its
 * rendered HEADING and gives the bar a short label instead — see
 * `ON_CALL_COMPLIANCE_BANDS`, where the two are separate fields. The slug is
 * always derived from the heading, so shortening a bar slot never moves an
 * anchor.
 */
function toSection(group: Group): PageSection {
  return {
    id: onCallGroupAnchorId(group.slug),
    label: group.label,
    icon: group.icon,
    // No `count`, deliberately: `count` is the ONLY thing that draws the rail's
    // badge, and the bar this mode now renders is bare words. `detail` is the
    // sheet's right-hand column, which has the room, so the number is still one
    // tap away — it is only the 48px-tall row of five words that does without.
    detail: `${group.count}`,
  };
}

/**
 * The owner's own order — `sort_order`, then title — which every shelf-shaped
 * page sorts by before it groups.
 *
 * Exported because `onCallEntryGroups` files in FIRST-SEEN order: group an
 * unsorted array here and the jump list can offer the groups in a different
 * order from the page, and two labels that collide to one slug ("ED / General"
 * and "ED General") would even be allocated different anchors on the two sides.
 * One comparator, imported by both, is what removes that whole class of drift.
 */
export function sortOnCallEntries(entries: readonly OnCallEntry[]): OnCallEntry[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

/** Contacts: overdue first, then one group per area — the page's own order. */
function contactGroups(entries: readonly OnCallEntry[], now: Date): Group[] {
  const { contacts } = partitionContactsEntries(entries);
  const groups: Group[] = [];

  // "Needs checking" is a HEADING on the page but not a slot in the bar. The
  // page hoists every overdue row to the top, so it is the first thing under
  // the header whichever group you were heading for — a bar slot spent on it
  // navigates to where you already are. Removing it is also what frees the
  // width for the areas, which are the reason anyone opens this page at 3am.
  const byArea = new Map<string, number>();
  for (const entry of contacts) {
    if (onCallEntryFreshness(entry, now).state === "stale") continue;
    // The same rule the page groups by: the first tag that is an area rather
    // than one of the home's control tags.
    const area = contactAreaLabel(entry);
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  // Seeded with the page's hoist heading so an area that normalizes to
  // "needs-checking" cannot steal that id. The bar does not list that heading
  // (it is already at the top), but the rendered section still carries it.
  const taken = new Set<string>(["needs-checking"]);
  for (const [area, count] of [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    groups.push({ slug: allocateOnCallGroupSlug(area, taken), label: area, count, icon: Phone });
  }
  return groups;
}

/**
 * Duplicated deliberately narrowly: the contacts list owns the rendering rule
 * and this owns the declaration, and the pair is pinned by a DOM test that
 * asserts every declared anchor exists on the rendered page. Importing the list
 * component here would make the header depend on the body it sits above.
 */
const RESERVED = ["call-first", "switchboard", "ward", "pinned"];
function contactAreaLabel(entry: OnCallEntry): string {
  const area = entry.tags
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0 && !RESERVED.includes(tag.toLowerCase()));
  return area ?? "General";
}

/** Where an Admin row lands when its details do not validate. */
export const ON_CALL_ADMIN_UNGROUPED_CATEGORY = "General";

/**
 * The folder an Admin row files under, for the jump list and the list alike.
 *
 * Read through the section's own schema rather than off the raw object,
 * because the list component parses before it renders: a row whose details
 * fail validation is drawn under the ungrouped folder there, so reading its
 * raw `category` here would declare a heading the page never draws.
 */
export function onCallAdminCategoryLabel(entry: OnCallEntry): string {
  const parsed = onCallDetailsSchemaFor("logistics").safeParse(entry.details);
  if (!parsed.success) return ON_CALL_ADMIN_UNGROUPED_CATEGORY;
  const category = (parsed.data as { category?: string }).category;
  return category ?? ON_CALL_ADMIN_UNGROUPED_CATEGORY;
}

/**
 * Admin: one group per `details.category`, with the compliance rows taken out.
 *
 * `partitionLogisticsEntries` rather than a `section === "logistics"` filter,
 * and this is the point of the function rather than a tidy-up. Admin and
 * Compliance are ONE stored section — `section` is a database CHECK constraint
 * and a seventh value costs a migration that reaches the live clinical
 * database, so the split lives in `details.kind` instead. The cost of that
 * choice is exactly one hazard, written down in `src/lib/on-call/compliance.ts`:
 * a compliance requirement appearing in the Admin list, where every other row
 * is a form or a process and nothing is expected to expire. A requirement that
 * lapses can stop someone working, and the last place it should be is a folder
 * of parking notes. This is one of the two surfaces that closes it; the list
 * component is the other.
 */
function adminGroups(entries: readonly OnCallEntry[]): Group[] {
  const { admin } = partitionLogisticsEntries(entries);
  const byCategory = new Map<string, number>();
  for (const entry of admin) {
    const category = onCallAdminCategoryLabel(entry);
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  const taken = new Set<string>();
  return [...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({
      slug: allocateOnCallGroupSlug(label, taken),
      label,
      count,
      icon: BriefcaseBusiness,
    }));
}

/**
 * What each consequence is called on the page, and the glyph it wears.
 *
 * TWO strings per band, and the split is the point. `heading` is the sentence
 * the page renders above the rows; `barLabel` is the single word the in-page
 * bar gets. The bar draws bare words that truncate rather than fold
 * (`wordmark-five` in src/components/mode-nav/mode-nav-bands.ts), and a slot in
 * that 48px row has about a word: "What you can authorise" measured 165px
 * against a 288px phone and was cut to "Authorise" for exactly this reason
 * (`tests/ui-on-call-boards.spec.ts`, board 11). One word per bar slot is the
 * convention every On Call page is calibrated for — do not restore a phrase
 * here without re-measuring at 320px.
 *
 * What the bar may NOT do is drop the sentence. "Stops you working" is this
 * page's whole meaning — it is why the bands are ordered the way they are — so
 * the heading keeps the phrase and only the navigation slot is shortened. The
 * anchor is matched by slug, and the slug is still derived from `heading`, so
 * the two sides cannot drift apart and no id changes.
 *
 * A Record keyed by the enum rather than four loose literals: adding a value to
 * `ON_CALL_COMPLIANCE_CONSEQUENCES` is then a compile error here until somebody
 * writes the words for it, instead of a band that silently never appears.
 *
 * Plain words, never the stored key. `stops-work` is a schema value, and a jump
 * list offering it asks the reader to translate the database at the moment they
 * are trying to find something. Each `barLabel` still names the CONSEQUENCE and
 * not a category — "Blocking", not "Registration" — because the one thing this
 * page is filed by is what lapsing costs.
 *
 * And no glyph here is a tick — nor is the view's own, which is why it is
 * `CalendarClock` rather than the `ShieldCheck` this page first wore: a shield
 * carrying a tick beside the word "Compliance" reads as a verdict, and a tick
 * on a BAND would read as a verdict on the rows underneath it,
 * and nothing in this app is checked with an issuing body — the page reports
 * what was recorded, on whose word, and leaves the judgement to the person
 * reading it (`src/lib/on-call/compliance.ts`, "What this page may never say").
 * These glyphs grade how bad the lapse is, which is the one thing the row
 * actually records. The short labels are held to the same rule: they grade the
 * lapse, and none of them says the reader holds anything.
 */
const COMPLIANCE_BAND_WORDS: Record<
  OnCallComplianceConsequence,
  { heading: string; barLabel: string; icon: LucideIcon }
> = {
  "stops-work": { heading: "Stops you working", barLabel: "Blocking", icon: OctagonAlert },
  // "Partial" reads against "Blocking" beside it — partially blocking — which
  // is what the band means and what its ordering says.
  "stops-part": { heading: "Stops part of your work", barLabel: "Partial", icon: TriangleAlert },
  chased: { heading: "Someone chases you", barLabel: "Chased", icon: Bell },
};

/**
 * The Compliance page's bands, worst consequence first.
 *
 * Mapped from `ON_CALL_COMPLIANCE_CONSEQUENCES` rather than retyped, because
 * that array's order is already load-bearing — `complianceSortRank` indexes
 * into it — and two hand-kept orders would eventually disagree about which
 * band is worse.
 *
 * Exported because the Compliance page renders these same four headings. One
 * character of difference between a heading and its declaration is an anchor
 * that does not exist and a jump list row that goes nowhere — which is also
 * why the slug is taken from `heading` on BOTH sides and never from the short
 * `barLabel`. Shortening a bar slot must never move an anchor.
 */
export const ON_CALL_COMPLIANCE_BANDS: readonly {
  consequence: OnCallComplianceConsequence | null;
  /** The sentence the page renders above the rows. Also the slug's source. */
  heading: string;
  /** The one word the in-page bar gets. See `COMPLIANCE_BAND_WORDS`. */
  barLabel: string;
  icon: LucideIcon;
}[] = [
  ...ON_CALL_COMPLIANCE_CONSEQUENCES.map((consequence) => ({ consequence, ...COMPLIANCE_BAND_WORDS[consequence] })),
  // Last, and never folded into the band above it. No recorded consequence is
  // unknown, not harmless: it cannot be ranked against a stated cost, and
  // guessing it a band would be the app forming precisely the judgement it
  // refuses to form. `complianceSortRank` puts these rows last for the same
  // reason.
  //
  // "Unrecorded" in the bar is a statement about the CONSEQUENCE field, which
  // is what this page files by — never about whether the requirement is held.
  { consequence: null, heading: "No consequence recorded", barLabel: "Unrecorded", icon: CircleHelp },
];

/**
 * Compliance: one band per consequence, worst first — not by category, and not
 * alphabetically.
 *
 * Category is how the Admin page files, and alphabetical order would put
 * "Someone chases you" above "Stops you working". Neither answers the question
 * this page is opened with, which is what to deal with first.
 */
function complianceGroups(entries: readonly OnCallEntry[]): Group[] {
  const { compliance } = partitionLogisticsEntries(entries);
  const taken = new Set<string>();
  const groups: Group[] = [];
  for (const band of ON_CALL_COMPLIANCE_BANDS) {
    const count = compliance.filter((entry) => (complianceConsequence(entry) ?? null) === band.consequence).length;
    // A band with nothing in it is not a heading on the page, so declaring it
    // would be a jump to an id that is not there.
    if (count === 0) continue;
    // Slug from the heading, label from the short word: the anchor keeps the
    // id the rendered heading allocates, and the bar gets a slot it can draw.
    groups.push({ slug: allocateOnCallGroupSlug(band.heading, taken), label: band.barLabel, count, icon: band.icon });
  }
  return groups;
}

/** Who's who: one group per area, the same shape Contacts uses. */
function whoIsWhoGroups(entries: readonly OnCallEntry[]): Group[] {
  const byArea = new Map<string, number>();
  for (const entry of entries.filter(isRoleExplainerEntry)) {
    const area = contactAreaLabel(entry);
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  const taken = new Set<string>();
  return [...byArea.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ slug: allocateOnCallGroupSlug(label, taken), label, count, icon: Users }));
}

/** Playbook: the scenarios, then the ones with nothing linked. */
function playbookGroups(entries: readonly OnCallEntry[], linkedIds: ReadonlySet<string>): Group[] {
  const playbook = entries.filter((entry) => (entry.view ?? entry.section) === "playbook");
  const linked = playbook.filter((entry) => entry.linkedDocumentIds.some((id) => linkedIds.has(id)));
  const unlinked = playbook.filter((entry) => !entry.linkedDocumentIds.some((id) => linkedIds.has(id)));
  const groups: Group[] = [];
  if (linked.length > 0) {
    groups.push({ slug: "scenarios", label: "Scenarios", count: linked.length, icon: Shield });
  }
  if (unlinked.length > 0) {
    groups.push({
      slug: "no-guideline",
      label: "Unlinked",
      count: unlinked.length,
      icon: FileText,
    });
  }
  return groups;
}

/**
 * Referrals: one group per tag, the same call the list makes.
 *
 * The page carried a chip row filing by exactly this facet. The chips are gone
 * — they named the same values the header's jump list names — so the tags
 * became headings, and this declares them. `onCallEntryGroups` returns nothing
 * when fewer than two tags are in play, which is what keeps a genuinely flat
 * page free of a one-row jump list.
 *
 * Orientation used to share this function and no longer does: a manual's folder
 * is a property of the manual, while its tags are how the owner goes looking
 * for it, and the two stopped being the same list the moment folders existed.
 */
function referralTagGroups(entries: readonly OnCallEntry[]): Group[] {
  const sorted = sortOnCallEntries(entries.filter((entry) => (entry.view ?? entry.section) === "referrals"));
  return onCallEntryGroups(sorted, onCallTagFacet, "Other services").map((group) => ({
    slug: group.slug,
    label: group.label,
    count: group.entries.length,
    icon: Repeat,
  }));
}

/**
 * The heading a manual with no folder files under — trailing, never dropped.
 *
 * One word, like every other folder on this page: the heading is also a slot
 * in the in-page bar (see `toSection`), and "Other manuals" spent two of them
 * saying what "Unfiled" says in one. "Unfiled" is also the more honest word —
 * these manuals are not a category, they are the ones nobody has filed.
 */
export const ON_CALL_ORIENTATION_UNFILED_LABEL = "Unfiled";

/**
 * Orientation's folder — "Induction", "Manuals", "Departure" — as a facet
 * reader.
 *
 * Optional on this section, unlike Admin's required `category`: orientation
 * rows already existed before folders did, and a required field would
 * invalidate every one of them on read. An empty result is what puts a manual
 * under the trailing fallback heading instead of losing it, which is the whole
 * reason `onCallEntryGroups` carries a fallback at all.
 *
 * Read off the raw object rather than through the section schema, and
 * deliberately: that schema also requires `pinnedSummaryIsOwnerNote`, so a
 * manual saved without an owner's note would parse as invalid and lose a folder
 * it plainly has.
 */
export const onCallOrientationCategoryFacet: OnCallFacetReader = (entry) => {
  const details = entry.details;
  if (typeof details !== "object" || details === null) return [];
  const category = (details as { category?: unknown }).category;
  return typeof category === "string" && category.trim().length > 0 ? [category.trim()] : [];
};

/** Orientation: one group per folder, in the shelf's own order. */
function orientationGroups(entries: readonly OnCallEntry[]): Group[] {
  const sorted = sortOnCallEntries(entries.filter((entry) => (entry.view ?? entry.section) === "orientation"));
  return onCallEntryGroups(sorted, onCallOrientationCategoryFacet, ON_CALL_ORIENTATION_UNFILED_LABEL).map((group) => ({
    slug: group.slug,
    label: group.label,
    count: group.entries.length,
    icon: BookOpen,
  }));
}

/**
 * One group is not navigation.
 *
 * `MODE_NAV_MIN_ITEMS` is the shared bar's own floor and says the same thing:
 * below two destinations a bar is a label. The page keeps its heading either
 * way — this only decides whether the header offers a way to move between
 * headings — and `onCallEntryGroups` already applies the identical rule to the
 * two pages that group by tag, so putting it here makes it one rule for all
 * seven rather than a habit three of them happen to share.
 */
function navigable(sections: PageSection[]): PageSection[] {
  return sections.length >= MODE_NAV_MIN_ITEMS ? sections : [];
}

export function onCallPageSections({
  view,
  entries,
  now = new Date(),
  linkedDocumentIds = new Set<string>(),
}: {
  view: OnCallPageView;
  entries: readonly OnCallEntry[];
  now?: Date;
  linkedDocumentIds?: ReadonlySet<string>;
}): PageSection[] {
  return navigable(pageGroups({ view, entries, now, linkedDocumentIds }));
}

function pageGroups({
  view,
  entries,
  now,
  linkedDocumentIds,
}: {
  view: OnCallPageView;
  entries: readonly OnCallEntry[];
  now: Date;
  linkedDocumentIds: ReadonlySet<string>;
}): PageSection[] {
  switch (view) {
    case "contacts":
      return contactGroups(entries, now).map(toSection);
    // Two views, one stored section. `logistics` is the Admin page and files by
    // folder; `compliance` is the same rows behind `details.kind` and files by
    // what happens when one lapses. Each takes its own half and neither ever
    // sees the other's — see `partitionLogisticsEntries`.
    case "logistics":
      return adminGroups(entries).map(toSection);
    case "compliance":
      return complianceGroups(entries).map(toSection);
    case "playbook":
      return playbookGroups(entries, linkedDocumentIds).map(toSection);
    case "who-is-who":
      return whoIsWhoGroups(entries).map(toSection);
    case "referrals":
      return referralTagGroups(entries).map(toSection);
    case "orientation":
      return orientationGroups(entries).map(toSection);
    // The one genuinely flat page: teaching sessions are dated, not filed, so
    // there is nothing to group by. A jump list of one row is furniture, and
    // the header drops straight back to being a title.
    case "education":
      return [];
  }
}

/**
 * The rebuilt shift pages' groups (kit 1.8), in page order. Each group renders
 * as `id="on-call-group-<slug>"`; empty groups are dropped before the bar sees
 * them, and one group alone is a heading, not navigation.
 *
 * Standard §5 and the r6 amendments: underlined tabs only FILTER one list and
 * carry three labels at most (`ON_CALL_CALL_TABS`, `ON_CALL_WHOS_ON_TABS`). A
 * page with more groups than that lists them through the header's chevron
 * sheet rather than a tab row.
 */
export const ON_CALL_HUB_GROUPS = {
  call: [
    { slug: "hospital", label: "Hospital", icon: Building2 },
    { slug: "wards", label: "Wards", icon: BedDouble },
    { slug: "external", label: "External", icon: Globe },
    { slug: "mine", label: "Mine", icon: UserRound },
  ],
  refer: [
    { slug: "hospital", label: "Hospital", icon: Building2 },
    { slug: "mine", label: "Mine", icon: UserRound },
  ],
  find: [
    { slug: "downtime", label: "Systems down", icon: CloudOff },
    { slug: "wards", label: "Wards", icon: BedDouble },
    { slug: "equipment", label: "Equipment", icon: Wrench },
    { slug: "manuals", label: "Manuals", icon: BookOpen },
    { slug: "other", label: "Other", icon: CircleHelp },
  ],
} as const satisfies Record<"call" | "refer" | "find", readonly { slug: string; label: string; icon: LucideIcon }[]>;

/** Call's filter tabs: one list, two labels (amendments r6, "Tabs"). */
export const ON_CALL_CALL_TABS = [
  { slug: "hospital", label: "Hospital" },
  { slug: "external", label: "External" },
] as const;

/** Who's on's filter tabs, for Stage C's roster days. */
export const ON_CALL_WHOS_ON_TABS = [
  { slug: "yesterday", label: "Yesterday" },
  { slug: "today", label: "Today" },
  { slug: "tomorrow", label: "Tomorrow" },
] as const;

export function onCallHubPageSections(
  page: "call" | "refer" | "find",
  counts: ReadonlyMap<string, number>,
): PageSection[] {
  return navigable(
    ON_CALL_HUB_GROUPS[page]
      .map((group) => ({ ...group, count: counts.get(group.slug) ?? 0 }))
      .filter((group) => group.count > 0)
      .map((group) => toSection(group)),
  );
}

/** Who's on's team groups: the reader's team first, then the common teams in order, then the rest by name. */
export function onCallWhosOnSections(
  teams: readonly { team: OnCallTeam; count: number }[],
  myTeam: OnCallTeam | null,
): PageSection[] {
  const taken = new Set<string>();
  return navigable(
    teams
      .filter((entry) => entry.count > 0)
      .sort((a, b) => Number(b.team === myTeam) - Number(a.team === myTeam) || compareOnCallTeams(a.team, b.team))
      .map((entry) =>
        toSection({
          slug: allocateOnCallGroupSlug(entry.team, taken),
          label: onCallTeamBarLabel(entry.team),
          count: entry.count,
          icon: Users,
        }),
      ),
  );
}
