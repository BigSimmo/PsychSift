import type { AppModeId } from "@/lib/app-modes";
import { WORK_AREAS, type WorkAreaId, type WorkFrameIconName } from "@/lib/work-frame/areas";
import { alternativeMatches, workSearchTerms } from "@/lib/work-search/terms";

/**
 * Pages in "Search my work": typing "leave", "export" or "fit test" offers the
 * page itself, so the 40-odd pages behind the More sheets are one search away.
 *
 * Built from the work frame's own navigation table (`WORK_AREAS`), so a page is
 * offered only when the frame lists it: never an action, never a page gated to
 * organisers, posters or editors (the reader may not be one), and each route
 * once, under the area that owns it. Page names only, never records.
 */

export interface WorkSearchPage {
  /** `<area>:<item id>`, unique. */
  readonly id: string;
  readonly label: string;
  /** The area it belongs to, as the band names it: "Roster", "CPD". */
  readonly area: string;
  /** The palette its dot is drawn in. */
  readonly identity: AppModeId;
  readonly sub: string | null;
  readonly href: string;
  readonly icon: WorkFrameIconName;
  /** Other words people use for the page. Matched with the label's weight. */
  readonly keywords: readonly string[];
}

/** Short synonym lists, keyed `<area id>:<item id>`. Plain words a reader might type for the page. */
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "day:my-day-today": ["home", "my day"],
  "day:my-day-week": ["this week", "week ahead"],
  "day:my-day-hours": ["worked", "rostered hours"],
  "day:my-day-all": ["to do", "tasks"],
  "day:my-day-profile": ["stage", "workplace", "profile"],
  "day:my-day-alerts": ["notifications", "quiet hours", "brief"],
  "day:my-day-privacy": ["data", "privacy"],
  "rost:month": ["calendar", "roster"],
  "rost:team": ["who is on", "colleagues"],
  "rost:swaps": ["swap", "trade", "cover"],
  "rost:today": ["today's shift"],
  "rost:shifts": ["shifts", "my roster"],
  "rost:requests": ["leave", "annual leave", "al", "holiday", "request", "book leave", "pdl", "study leave"],
  "rost:hours": ["overtime", "rest", "fatigue", "safe hours"],
  "open:open-shifts-browse": ["extra shifts", "locum", "open shifts", "available shifts"],
  "open:open-shifts-mine": ["booked", "asked"],
  "open:open-shifts-log": ["log shift", "extra shift worked"],
  "open:open-shifts-alerts": ["notify", "shift alerts"],
  "manage:manage-inbox": ["approve", "approvals", "manager", "manage roster"],
  "manage:manage-cover": ["gaps", "unfilled", "sick cover"],
  "manage:manage-team": ["publish", "team settings", "people"],
  "rost:calendar": ["sync", "ical", "ics", "phone calendar", "google calendar", "outlook"],
  "rost:join": ["invite", "code", "join"],
  "rost:settings": ["preferences"],
  "teach:today": ["teaching"],
  "teach:week": ["sessions", "timetable", "this week"],
  "teach:logbook": ["attendance", "record", "log"],
  "teach:teach": ["presenting", "my talk", "talks", "presentation"],
  "teach:whats-on": ["grand rounds", "other services"],
  "teach:term": ["term dates", "goals"],
  "teach:resources": ["slides", "papers", "reading"],
  "teach:feedback": ["rate", "survey"],
  "teach:review": ["log to cpd", "weekly review"],
  "teach:exam-prep": ["exam", "study", "revision"],
  "assess:assess-todo": ["assessments", "wba", "forms"],
  "assess:assess-progress": ["epa", "epas", "progress"],
  "assess:assess-supervision": ["supervision", "supervisor", "hours to confirm"],
  "assess:assess-times": ["times"],
  "assess:assess-history": ["past assessments"],
  "assess:assess-help": ["help"],
  "cpd:year": ["cpd", "cme", "summary", "hours"],
  "cpd:log": ["activities", "log cpd", "add activity"],
  "cpd:learning": ["courses", "learning", "conferences"],
  "cpd:setup": ["report", "year check", "audit"],
  "cpd:plan": ["pdp", "development plan", "goals"],
  "cpd:targets": ["requirements", "minimums", "targets"],
  "cpd:training": ["registrar", "training record"],
  "cpd:finish": ["drafts", "unfinished"],
  "cpd:routines": ["regular", "routine"],
  "admin:admin-today": ["admin", "to do"],
  "admin:renewals": ["renew", "expiry", "expiring", "registration", "ahpra", "bls", "certificates"],
  "admin:new-job": ["onboarding", "credentials", "wallet", "starting", "new job"],
  "admin:admin-compliance": ["mandatory", "training", "fit test", "mask fit", "compliance"],
  "admin:admin-export": ["spreadsheet", "csv", "download", "export"],
  "admin:help": ["crisis", "support", "eap", "wellbeing", "help"],
  "admin:admin-overtime": ["overtime", "claims", "extra hours"],
  "call:now": ["on call", "tonight", "shift"],
  "call:call": ["phone", "numbers", "switchboard", "pager", "contacts", "ring"],
  "call:refer": ["referral", "referrals", "refer"],
  "call:find": ["handbook", "wards", "equipment", "systems down"],
  "call:playbook": ["what to do", "emergency", "codes"],
  "call:whoswho": ["roles", "teams"],
  "call:orientation": ["checklist", "induction", "orientation"],
  "call:card": ["print", "pocket card"],
  "call:call-now": ["who to call", "escalate"],
  "call:whoson": ["tonight's team", "who's on"],
  "call:pulse": ["how is it going", "workload"],
  "call:check": ["before you leave", "checklist"],
  "call:first-night": ["new", "first shift"],
  "call:handover": ["handover"],
};

let pagesMemory: readonly WorkSearchPage[] | null = null;

/** Every page the work frame lists, once each, in the frame's own order. */
export function workSearchPages(): readonly WorkSearchPage[] {
  if (pagesMemory) return pagesMemory;
  const pages: WorkSearchPage[] = [];
  const seen = new Set<string>();
  const areas = Object.entries(WORK_AREAS) as [WorkAreaId, (typeof WORK_AREAS)[WorkAreaId]][];
  // An inner area whose way in is gated (Manage team, for roster managers) is gated as a whole.
  const gatedAreas = new Set(
    areas
      .flatMap(([, area]) => area.groups.flatMap((group) => group.items))
      .filter((item) => item.opens && item.gate)
      .map((item) => item.opens),
  );
  for (const [areaId, area] of areas) {
    if (gatedAreas.has(areaId)) continue;
    const items = [...area.tabs, ...area.groups.flatMap((group) => group.items)];
    for (const item of items) {
      // Actions run on a page, and gated pages may not be the reader's: neither is offered.
      if (!item.href || item.gate) continue;
      // A link into another area (`paths: []` or `leadsTo`) is listed under its own area.
      if (item.leadsTo || (item.paths && item.paths.length === 0)) continue;
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      pages.push({
        id: `${areaId}:${item.id}`,
        label: item.label,
        area: area.name,
        identity: area.identity,
        sub: item.sub ?? null,
        href: item.href,
        icon: item.icon,
        keywords: KEYWORDS[`${areaId}:${item.id}`] ?? [],
      });
    }
  }
  pagesMemory = pages;
  return pages;
}

export interface WorkSearchPageHit {
  readonly page: WorkSearchPage;
  /** 0 the page's name, 1 a word people use for it, 2 its line or its area's name. */
  readonly rank: 0 | 1 | 2;
}

/**
 * Pages matching every typed word, best first: a name match before a synonym,
 * before a match on the area's name alone ("roster" lists the Roster pages, but
 * after any page called "Roster"). One-letter-out typos match as in record search.
 */
export function searchWorkPages(
  query: string,
  pages: readonly WorkSearchPage[] = workSearchPages(),
): WorkSearchPageHit[] {
  const terms = workSearchTerms(query);
  if (terms.length === 0) return [];
  const hits: WorkSearchPageHit[] = [];
  for (const page of pages) {
    const tiers = [
      [page.label.toLowerCase()],
      page.keywords.map((keyword) => keyword.toLowerCase()),
      [page.area.toLowerCase(), (page.sub ?? "").toLowerCase()],
    ];
    let worst = 0;
    let matched = true;
    for (const alternatives of terms) {
      const best = tiers.findIndex((fields) =>
        fields.some((field) => alternatives.some((alternative) => alternativeMatches(field, alternative))),
      );
      if (best === -1) {
        matched = false;
        break;
      }
      worst = Math.max(worst, best);
    }
    if (matched) hits.push({ page, rank: worst as 0 | 1 | 2 });
  }
  return hits.sort((a, b) => a.rank - b.rank);
}
