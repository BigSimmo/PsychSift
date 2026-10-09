import { contractEndSearchRecords } from "@/lib/admin/contract-end";
import { leaveWalletSearchRecords } from "@/lib/admin/leave-types";
import { readySearchRecords } from "@/lib/admin/ready-for-day-one";
import { starterPackSearchRecords } from "@/lib/admin/starter-pack";
import { applicationsSearchRecords, type ApplicationsState } from "@/lib/cme/applications";
import { cpdHomeSearchRecords } from "@/lib/cme/cpd-home-send";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { firstWeekSearchRecords } from "@/lib/on-call/first-week-pack";
import { rosterWhosOnSearchRecords } from "@/lib/on-call/roster-whos-on";
import { ROSTER_FEATURE_SEARCH_RECORDS } from "@/lib/roster/sick/sick-report";
import { assessmentsSampleSearchEntries } from "@/lib/teaching/assessments/overview";
import { termFolderSearchEntries } from "@/lib/teaching/term-folder";
import { WORK_AREAS, type WorkAreaId, type WorkFrameIconName } from "@/lib/work-frame/areas";
import { agreementWorkSearchAnswer, agreementWorkSearchRecords } from "@/lib/work-profile/agreement-answers";
import type { WorkAnswer } from "@/lib/work-search/answers";
import type { WorkSearchPage } from "@/lib/work-search/pages";

/**
 * The junior features' pages in "Search my work". Each feature hands over its
 * own search records (titles and keywords only, never record text from a
 * server); here they become `WorkSearchPage`s beside the frame's own pages, so
 * typing "sick", "contract" or "referee" offers the page.
 *
 * Two providers carry the doctor's own words from this device: the contract end
 * date (from their own On Call entries) and Job applications (season dates and
 * referees' names). Both are left out for a signed-out visitor, and example
 * records never reach them.
 */

interface FeatureSearchRecord {
  readonly id?: string;
  readonly title: string;
  readonly detail?: string;
  readonly keywords: readonly string[];
  readonly href: string;
}

interface FeatureSearchGroup {
  readonly area: WorkAreaId;
  readonly icon: WorkFrameIconName;
  readonly records: readonly FeatureSearchRecord[];
}

/** What the reader's own device holds for the two providers that list it, or null when signed out. */
export interface FeatureSearchOwn {
  /** The reader's own On Call entries (contract end date), or null when they are not read yet. */
  readonly entries: readonly OnCallEntry[] | null;
  /** Job applications on this device, or null until read. */
  readonly applications: ApplicationsState | null;
}

function featureGroups(own: FeatureSearchOwn | null): FeatureSearchGroup[] {
  const entries = own?.entries ? withoutExampleRecords(own.entries) : [];
  const applications = own?.applications
    ? { ...own.applications, referees: withoutExampleRecords(own.applications.referees) }
    : null;
  return [
    { area: "call", icon: "book", records: firstWeekSearchRecords() },
    { area: "call", icon: "users", records: rosterWhosOnSearchRecords() },
    { area: "rost", icon: "calendar", records: ROSTER_FEATURE_SEARCH_RECORDS },
    { area: "rost", icon: "book", records: agreementWorkSearchRecords() },
    { area: "admin", icon: "file", records: contractEndSearchRecords(entries) },
    { area: "admin", icon: "calendar", records: leaveWalletSearchRecords() },
    { area: "admin", icon: "compass", records: starterPackSearchRecords() },
    { area: "admin", icon: "check-list", records: readySearchRecords() },
    { area: "cpd", icon: "upload", records: cpdHomeSearchRecords() },
    ...(applications
      ? [{ area: "cpd" as const, icon: "flag" as const, records: applicationsSearchRecords(applications) }]
      : []),
    { area: "teach", icon: "folder", records: termFolderSearchEntries() },
    // Pages only: the two made-up sample views hold no real records. Signed out only, like the
    // Assessments example itself: a signed-in doctor's records are kept in CLA, and these pages would
    // show them only the "kept in CLA" notice.
    ...(own === null
      ? [{ area: "assess" as const, icon: "inbox" as const, records: assessmentsSampleSearchEntries() }]
      : []),
  ];
}

/** Every feature page as a `WorkSearchPage`, each id once. */
export function featureSearchPages(own: FeatureSearchOwn | null): WorkSearchPage[] {
  const pages: WorkSearchPage[] = [];
  const seen = new Set<string>();
  for (const group of featureGroups(own)) {
    const area = WORK_AREAS[group.area];
    for (const record of group.records) {
      const id = `${group.area}:feature:${record.id ?? `${record.href}|${record.title}`}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pages.push({
        id,
        label: record.title,
        area: area.name,
        identity: area.identity,
        sub: record.detail ?? null,
        href: record.href,
        icon: group.icon,
        keywords: record.keywords,
      });
    }
  }
  return pages;
}

/**
 * The frame's pages with the features' pages added. A feature page the frame
 * already lists (once its More entry lands) is not offered twice: the frame's
 * page keeps its name and gains the feature's title and words.
 */
export function withFeaturePages(
  framePages: readonly WorkSearchPage[],
  featurePages: readonly WorkSearchPage[],
): WorkSearchPage[] {
  const byHref = new Map(framePages.map((page) => [page.href, page]));
  const extra = new Map<string, string[]>();
  const added: WorkSearchPage[] = [];
  for (const page of featurePages) {
    const frame = byHref.get(page.href);
    if (!frame) {
      added.push(page);
      continue;
    }
    extra.set(frame.href, [...(extra.get(frame.href) ?? []), page.label, ...page.keywords]);
  }
  const merged = framePages.map((page) => {
    const words = extra.get(page.href);
    return words ? { ...page, keywords: [...new Set([...page.keywords, ...words])] } : page;
  });
  return [...merged, ...added];
}

const NOT_SIGNED_OFF =
  "Not signed off yet. The words are the agreement's, but check the clause in the agreement before you rely on it.";

/**
 * "Can I be rostered 16 hours?": the agreement's own words as a work search
 * answer, quoted with its clause, or an honest "not checked" for an
 * entitlement question it does not cover. Null for anything else, and for
 * patient details (the search shows its own catch then).
 */
export function agreementWorkAnswer(query: string): WorkAnswer | null {
  const answer = agreementWorkSearchAnswer(query);
  if (!answer) return null;
  const quoted = answer.kind === "quoted";
  return {
    area: "roster",
    icon: "shift",
    label: "From the agreement",
    headline: answer.title,
    sub: quoted ? `“${answer.detail}”` : answer.detail,
    meta: answer.clauses.map((clause) => `Clause ${clause}`),
    items: [],
    understood: quoted ? "Showing what the agreement says, word for word" : "Read as a question about the agreement",
    source: quoted ? "Quoted from the agreement" : "Not checked against the agreement for this question",
    ...(quoted && !answer.signedOff ? { footnote: NOT_SIGNED_OFF } : {}),
    note: `Not sure, or disagree? ${answer.union}, your union.`,
    action: { label: "Open the agreement", href: answer.href },
  };
}
