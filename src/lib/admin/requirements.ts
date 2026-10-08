import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn, entryNotForThisJob, isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * The statewide Requirements catalogue (spec review 27): a sourced, dated
 * template of the mandatory and usual requirements for a WA Health hospital
 * doctor, crossed with the doctor's own compliance records so Renewals can
 * show an interactive checklist rather than a single unsourced list.
 *
 * Content is drawn from `requirements-content.md`, checked 2026-09-26. Every
 * item is public official information (a government or college policy page),
 * so it is fine to hold in this public repository.
 *
 * ## What this may never do
 *
 * The source document grades every fact VERIFIED (the cited page states it
 * directly, in the quoted words) or NEEDS CHECKING (a specific reason —
 * unreachable page, ambiguous wording, or a newer version may exist). Only a
 * VERIFIED fact may appear as `rule`; a NEEDS CHECKING item carries no `rule`
 * at all, only `whatIsUnconfirmed`, so nothing here ever states a fact this
 * app has not actually confirmed. This is the same discipline the rest of
 * Admin holds about a doctor's own dates — see `compliance.ts`'s "What this
 * page may never say" — extended to the catalogue itself.
 */
export const ADMIN_REQUIREMENT_GROUPS = ["registration", "checks", "health", "training", "job"] as const;
export type AdminRequirementGroup = (typeof ADMIN_REQUIREMENT_GROUPS)[number];

export type AdminRequirementStatus = "confirmed" | "needs-checking";

export interface AdminRequirementCatalogueItem {
  /** A short slug. Every REAL catalogue item's id is one of `ADMIN_REQUIREMENT_IDS` (the
   *  list `on-call/entry-model.ts` validates a stored `requirementId` against) —
   *  `tests/admin-requirements.test.ts` pins the two lists to match exactly. Left as
   *  `string` here, not that literal union, so a test may build its own throwaway
   *  catalogue items without coupling to the real 20 ids. */
  readonly id: string;
  /** 2-4 words, for a narrow checklist row. */
  readonly title: string;
  readonly group: AdminRequirementGroup;
  readonly status: AdminRequirementStatus;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** `YYYY-MM-DD`, the date the source was checked. */
  readonly updated: string;
  /** A plain-sentence, sourced fact. Present only when `status` is "confirmed". */
  readonly rule?: string;
  /** One short line saying what is not yet confirmed. Present only when `status` is "needs-checking". */
  readonly whatIsUnconfirmed?: string;
}

const CHECKED = "2026-09-26";

export const ADMIN_REQUIREMENTS_CATALOGUE: readonly AdminRequirementCatalogueItem[] = [
  {
    id: "medical-registration-renewal",
    title: "Medical registration renewal",
    group: "registration",
    status: "confirmed",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/registration/registration-renewal.aspx",
    updated: CHECKED,
    rule: "Registration for medical practitioners with general, specialist or non-practising registration renews annually, due 30 September. Missing the one-month late period after that removes your name from the Register of practitioners.",
  },
  {
    id: "cpd-home-and-hours",
    title: "CPD hours requirement",
    group: "training",
    status: "confirmed",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/Professional-Performance-Framework/CPD/What--do-I-need-to-do.aspx",
    updated: CHECKED,
    rule: "You need to be enrolled in an AMC-accredited CPD home and complete 50 hours of CPD each calendar year: at least 25 hours reviewing performance and measuring outcomes, 12.5 hours of traditional learning, and 12.5 hours from any category.",
  },
  {
    id: "recency-of-practice",
    title: "Recency of practice",
    group: "registration",
    status: "confirmed",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/Codes-Guidelines-Policies/FAQ/FAQ-Recency-of-practice.aspx",
    updated: CHECKED,
    rule: "Registration requires either four weeks full-time equivalent practice in one registration period, or twelve weeks full-time equivalent over three consecutive periods.",
  },
  {
    id: "professional-indemnity-insurance",
    title: "Indemnity insurance declaration",
    group: "registration",
    status: "needs-checking",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/sitecore/content/Home/Registration/Registration-Standards/PII.aspx",
    updated: CHECKED,
    whatIsUnconfirmed:
      "Whether an employed hospital doctor already insured under the employer's indemnity scheme still needs a personal declaration is not stated.",
  },
  {
    id: "medicare-provider-number",
    title: "Medicare provider number",
    group: "registration",
    status: "needs-checking",
    sourceName: "Services Australia",
    sourceUrl: "https://www.servicesaustralia.gov.au/provider-and-prescriber-numbers?context=20",
    updated: CHECKED,
    whatIsUnconfirmed:
      "Whether it's a mandatory precondition of any WA Health hospital role, or only needed for MBS/PBS claiming, is not stated.",
  },
  {
    id: "working-with-children-check",
    title: "Working with Children Check",
    group: "checks",
    status: "confirmed",
    sourceName: "WA Department of Communities",
    sourceUrl:
      "https://www.wa.gov.au/organisation/department-of-communities/working-children-check-application-and-renewal-process",
    updated: CHECKED,
    rule: "A WWC Card lasts three years and can be renewed up to three months before that three years is up. Doing child-related work once the card's three years have passed, with no renewal application pending, is an offence.",
  },
  {
    id: "wwc-check-applicability",
    title: "WWC check applicability",
    group: "checks",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Employment/Mandatory-requirements/Human-Resource-Management/Working-with-Children-Check-Policy",
    updated: CHECKED,
    whatIsUnconfirmed:
      "WA Health says this is role-dependent, not automatic for every doctor, but the policy page doesn't give the criteria for which hospital roles it covers.",
  },
  {
    id: "criminal-record-screening",
    title: "Criminal record screening",
    group: "checks",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Employment/Mandatory-requirements/Human-Resource-Management/Criminal-Record-Screening-Policy",
    updated: CHECKED,
    whatIsUnconfirmed:
      "Mandatory for anyone providing health services to the WA health system, but the 3-year renewal figure comes only from a third-party mirror of a WA Health FAQ, not the live procedure document.",
  },
  {
    id: "immunisation-requirements",
    title: "Immunisation requirements",
    group: "health",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Public-Health/Mandatory-requirements/Communicable-Disease-Control/Immunisation/Health-Care-Worker-Immunisation-Policy",
    updated: CHECKED,
    whatIsUnconfirmed:
      "The vaccine list and dose counts come from a 2012 document mirrored on a hospital subdomain, not from a current document on the main policy page.",
  },
  {
    id: "annual-influenza-vaccination",
    title: "Annual flu vaccination",
    group: "health",
    status: "confirmed",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Public-Health/Mandatory-requirements/Communicable-Disease-Control/Immunisation/Staff-Member-Influenza-Vaccination-Program-Policy",
    updated: CHECKED,
    rule: "Annual influenza vaccination is a mandatory yearly requirement for WA health entity staff.",
  },
  {
    id: "respirator-fit-testing",
    title: "Respirator fit testing",
    group: "health",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl: "https://www.health.wa.gov.au/Articles/N_R/Respiratory-Protection-Program",
    updated: CHECKED,
    whatIsUnconfirmed:
      "Which staff must be fit tested, and whether there's a fixed renewal interval rather than only event-triggered retesting, couldn't be confirmed from the page that was reachable.",
  },
  {
    id: "mandatory-training-modules",
    title: "Mandatory training modules",
    group: "training",
    status: "needs-checking",
    sourceName: "WA Country Health Service",
    sourceUrl:
      "https://www.wacountry.health.wa.gov.au/~/media/WACHS/Documents/About-us/Policies/Mandatory-Training-Policy.pdf",
    updated: CHECKED,
    whatIsUnconfirmed:
      "The actual module list and how often each repeats sit in a separate Training Matrix document, which wasn't retrieved.",
  },
  {
    id: "resuscitation-competence",
    title: "Resuscitation competence check",
    group: "training",
    status: "confirmed",
    sourceName: "WA Country Health Service",
    sourceUrl:
      "https://www.wacountry.health.wa.gov.au/~/media/WACHS/Documents/About-us/Policies/Resuscitation-Education-and-Competency-Assessment-Policy.pdf",
    updated: CHECKED,
    rule: "Under WACHS policy, junior medical staff must demonstrate BLS competence annually (assessed with ALS). Senior medical staff resuscitation training is set locally by the site's Director of Medical Services.",
  },
  {
    id: "als-course-certification",
    title: "ALS course certification",
    group: "training",
    status: "confirmed",
    sourceName: "Australian Resuscitation Council",
    sourceUrl: "https://resus.org.au/als-courses/",
    updated: CHECKED,
    rule: "Australian Resuscitation Council ALS1/ALS2 course certification runs for up to four years, with a shorter recertification course available before it lapses.",
  },
  {
    id: "credentialing-and-scope",
    title: "Credentialing and scope",
    group: "job",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Clinical-Governance-Safety-and-Quality/Mandatory-requirements/Credentialing-and-Defining-Scope-of-Clinical-Practice-Policy",
    updated: CHECKED,
    whatIsUnconfirmed:
      "The policy page repeatedly returned a 404 when fetched directly, so scope, frequency and consequence wording couldn't be confirmed.",
  },
  {
    id: "provisional-to-general-registration",
    title: "Provisional to general registration",
    group: "job",
    status: "confirmed",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/registration/interns/provisional-to-general-registration.aspx",
    updated: CHECKED,
    rule: "Interns should apply for general registration at least four months before finishing internship (the Board encourages at least four weeks). If internship won't finish in time, renew provisional registration instead of applying for general registration.",
  },
  {
    id: "img-supervised-practice",
    title: "IMG supervised practice",
    group: "job",
    status: "confirmed",
    sourceName: "Medical Board of Australia",
    sourceUrl: "https://www.medicalboard.gov.au/Registration/International-Medical-Graduates/Supervision.aspx",
    updated: CHECKED,
    rule: "International medical graduates granted limited or provisional registration must be supervised for as long as that registration lasts.",
  },
  {
    id: "img-visa-requirements",
    title: "IMG visa requirements",
    group: "job",
    status: "needs-checking",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/Careers/International-applicants/International-medical-graduates/Australian-visa-requirements",
    updated: CHECKED,
    whatIsUnconfirmed:
      "No specific visa subclass, how long a visa lasts, or renewal detail is stated. Visa rules sit with the Department of Home Affairs, which this review did not look at directly.",
  },
  {
    id: "code-of-conduct",
    title: "Code of Conduct",
    group: "job",
    status: "confirmed",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/about-us/policy-frameworks/employment/mandatory-requirements/human-resource-management/code-of-conduct-policy",
    updated: CHECKED,
    rule: "All staff within the WA health system, including doctors, must comply with the WA Health Code of Conduct alongside their own profession's codes of conduct and ethics.",
  },
  {
    id: "aboriginal-cultural-elearning",
    title: "Aboriginal Cultural eLearning",
    group: "training",
    status: "confirmed",
    sourceName: "WA Department of Health",
    sourceUrl:
      "https://www.health.wa.gov.au/About-us/Policy-frameworks/Employment/Mandatory-requirements/Human-Resource-Management/Aboriginal-Cultural-eLearning-Policy",
    updated: CHECKED,
    rule: "Aboriginal Cultural eLearning is a mandatory requirement for all WA health entities' staff.",
  },
];

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase();
}

function entryRequirementId(entry: OnCallEntry): unknown {
  const details = entry.details;
  return typeof details === "object" && details !== null
    ? (details as { requirementId?: unknown }).requirementId
    : undefined;
}

/**
 * The one catalogue item a compliance entry is recorded against, if any: a
 * stored `requirementId` that names a catalogue item wins outright, and only
 * an entry without one falls back to its title. So an entry corresponds to at
 * most ONE item — a row saved as "als-course-certification" but titled like
 * another item never satisfies both. Rows from other sections, and logistics
 * guides, never correspond to anything.
 *
 * This is the one matcher: `requirementChecklistRows`, the recorded count,
 * the not-for-this-job list, Today's selectors and Renewals' Personal tab
 * (`src/components/admin/renewals/catalogue-lookup.ts`) all build on it.
 */
export function catalogueItemForEntry(
  entry: OnCallEntry,
  catalogue: readonly AdminRequirementCatalogueItem[] = ADMIN_REQUIREMENTS_CATALOGUE,
): AdminRequirementCatalogueItem | undefined {
  if (!isComplianceEntry(entry)) return undefined;
  const requirementId = entryRequirementId(entry);
  const byId = catalogue.find((item) => item.id === requirementId);
  if (byId) return byId;
  const title = normalizedTitle(entry.title);
  return catalogue.find((item) => normalizedTitle(item.title) === title);
}

/**
 * Whether `entry` is this catalogue item's requirement AT ALL, regardless of
 * whether it is flagged "not for this job". `matchingEntry`,
 * `requirementsRecordedCount` and `requirementsNotForThisJob` all build on
 * it, so they can never disagree about which entries correspond to an item.
 */
function isItemsEntry(
  entry: OnCallEntry,
  item: AdminRequirementCatalogueItem,
  catalogue: readonly AdminRequirementCatalogueItem[],
): boolean {
  return catalogueItemForEntry(entry, catalogue)?.id === item.id;
}

/**
 * The entry a catalogue item's requirement is recorded against, if any —
 * matched by a stored `requirementId` first, then by title. An entry flagged
 * "not for this job" (`entryNotForThisJob`) is never a match: that requirement
 * does not apply to this doctor, so it must not read as recorded.
 */
function matchingEntry(
  item: AdminRequirementCatalogueItem,
  entries: readonly OnCallEntry[],
  catalogue: readonly AdminRequirementCatalogueItem[],
): OnCallEntry | null {
  const candidates = entries.filter((entry) => isItemsEntry(entry, item, catalogue) && !entryNotForThisJob(entry));
  const byId = candidates.find((entry) => entryRequirementId(entry) === item.id);
  return byId ?? candidates[0] ?? null;
}

export type RequirementRowState = "needs-action" | "no-end-date" | "not-recorded";

export interface RequirementChecklistRow {
  readonly item: AdminRequirementCatalogueItem;
  /** The doctor's own compliance entry for this item, or `null` when it has never been recorded. */
  readonly entry: OnCallEntry | null;
  readonly expiresOn: string | undefined;
  readonly state: RequirementRowState;
}

function rowState(entry: OnCallEntry | null, expiresOn: string | undefined): RequirementRowState {
  if (!entry) return "not-recorded";
  return expiresOn ? "needs-action" : "no-end-date";
}

/**
 * Every catalogue item, matched against the doctor's own compliance entries,
 * in the checklist's order (spec review 29): soonest recorded date first, then
 * rows recorded with no end date, then the "not recorded yet" slots — the
 * catalogue items that have no matching entry at all.
 */
export function requirementChecklistRows(
  catalogue: readonly AdminRequirementCatalogueItem[],
  entries: readonly OnCallEntry[],
): RequirementChecklistRow[] {
  const rows = catalogue.map((item) => {
    const entry = matchingEntry(item, entries, catalogue);
    const expiresOn = entry ? complianceExpiresOn(entry) : undefined;
    return { item, entry, expiresOn, state: rowState(entry, expiresOn) };
  });
  const rank: Record<RequirementRowState, number> = { "needs-action": 0, "no-end-date": 1, "not-recorded": 2 };
  return rows.sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    if (a.state === "needs-action" && b.state === "needs-action" && a.expiresOn !== b.expiresOn) {
      return (a.expiresOn as string) < (b.expiresOn as string) ? -1 : 1;
    }
    return a.item.title.localeCompare(b.item.title);
  });
}

/**
 * The checklist a page shows: `requirementChecklistRows` minus the items
 * marked "not for this job" (`requirementsNotForThisJob`), which live in their
 * own closing section instead. Without this, a flagged item would appear twice
 * — once as "Not recorded yet" and once under "Not for this job". Renewals,
 * Today and "Your Admin records" all read this.
 */
export function requirementChecklistRowsForJob(
  catalogue: readonly AdminRequirementCatalogueItem[],
  entries: readonly OnCallEntry[],
): RequirementChecklistRow[] {
  const excluded = new Set(requirementsNotForThisJob(catalogue, entries).map(({ item }) => item.id));
  return requirementChecklistRows(catalogue, entries).filter((row) => !excluded.has(row.item.id));
}

/**
 * The "X of Y recorded" count (spec review 27: "a small '7 of 11 recorded'
 * ring, never a verdict"). A catalogue item whose matching entry is marked
 * "not for this job" leaves the count entirely — it is neither recorded nor
 * counted as outstanding, mirroring `groupComplianceEntries` in
 * `src/lib/admin/renewals.ts`.
 *
 * Built entirely from `matchingEntry` (the same function
 * `requirementChecklistRows` uses) rather than re-deriving its own match, so
 * the two can never disagree: an unflagged entry, when one exists, always
 * wins over a flagged one for the same item — the item is excluded from the
 * count only when NO unflagged entry matches it but a flagged one does.
 */
export function requirementsRecordedCount(
  catalogue: readonly AdminRequirementCatalogueItem[],
  entries: readonly OnCallEntry[],
): { recorded: number; total: number } {
  let recorded = 0;
  let total = 0;
  for (const item of catalogue) {
    const entry = matchingEntry(item, entries, catalogue);
    if (entry) {
      total += 1;
      recorded += 1;
      continue;
    }
    if (flaggedEntryFor(item, entries, catalogue)) continue;
    total += 1;
  }
  return { recorded, total };
}

function flaggedEntryFor(
  item: AdminRequirementCatalogueItem,
  entries: readonly OnCallEntry[],
  catalogue: readonly AdminRequirementCatalogueItem[],
): OnCallEntry | undefined {
  return entries.find((candidate) => isItemsEntry(candidate, item, catalogue) && entryNotForThisJob(candidate));
}

/**
 * The catalogue items marked "not for this job", one entry each, in catalogue
 * order: exactly the items `requirementsRecordedCount` leaves out of `total`
 * (no unflagged entry matches, a flagged one does). Today's "1 not for this
 * job" and Renewals' closing section both read this, so their counts agree
 * even when one item has two flagged rows, or a flagged and an unflagged one.
 */
export function requirementsNotForThisJob(
  catalogue: readonly AdminRequirementCatalogueItem[],
  entries: readonly OnCallEntry[],
): { readonly item: AdminRequirementCatalogueItem; readonly entry: OnCallEntry }[] {
  return catalogue.flatMap((item) => {
    if (matchingEntry(item, entries, catalogue)) return [];
    const entry = flaggedEntryFor(item, entries, catalogue);
    return entry ? [{ item, entry }] : [];
  });
}

/**
 * The one line a checklist row shows for its recorded date: absolute date
 * first, then a passed date carried in words rather than colour, exactly as
 * the rest of Admin describes a passed date (see `AdminTodayPage`). Never
 * "expired" or "lapsed" — see `compliance.ts`'s `recordedExpiryHasPassed`.
 */
export function requirementDateDescription(expiresOn: string | undefined, now: Date): string {
  if (!expiresOn) return "";
  const passed = expiresOn < perthCalendarDate(now);
  return `Recorded as expiring ${formatRecordedDate(expiresOn)}${passed ? " — that date has passed" : ""}`;
}
