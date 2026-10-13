export type HubPanelGroup = "work" | "clinical" | "system" | "reference";

export type HubPanel = {
  id: string;
  name: string;
  summary: string;
  group: HubPanelGroup;
  /** 1 = built now. 2–4 = declared placeholder; flipping the phase and adding an href is the whole change. */
  phase: 1 | 2 | 3 | 4;
  href?: string;
  /** The href is a static file under `public/`, not an app route. Rendered as a
   *  plain anchor rather than a <Link>, and excluded from the route-existence
   *  check — which reads the route manifest and would not find it. */
  external?: boolean;
};

export const HUB_PANELS: readonly HubPanel[] = [
  {
    id: "roster-teams",
    name: "Roster teams",
    summary: "Confirm teams and appoint roster managers",
    group: "work",
    phase: 1,
    href: "/admin/developer-hub/roster-teams",
  },
  {
    id: "task-ledger",
    name: "Task ledger",
    summary: "Outstanding work, in recommended order",
    group: "work",
    phase: 1,
    href: "/admin/developer-hub/ledger",
  },
  // `decision-log` (phase 4) was removed 2026-08-25, along with `errors`,
  // `budgets` and `commands` below, and `database-drift` (phase 3) for the
  // same reason: `.github/workflows/live-drift.yml` already creates and
  // updates a GitHub issue on drift. Each restated a fact the repository
  // already surfaces elsewhere — exactly what Ruling R1 forbids ("render only
  // facts no green gate already guarantees"), and every placeholder card is a
  // promise on screen: a card that never arrives quietly tells a reader work
  // is coming which is not. `decision-log`'s specific case: `docs/decisions/`
  // holds exactly one file, so the gap is that decisions are not being
  // written down, not that they are not being rendered — a page over one
  // document would make the gap look addressed. Do not re-add these five
  // believing they were forgotten.

  {
    id: "clinical-trust",
    name: "Clinical trust cockpit",
    summary: "Quality feedback, source-change impact, and content maturity",
    group: "clinical",
    phase: 1,
    href: "/admin/developer-hub/clinical-trust",
  },
  // Named for its evidence, not for its subject. It reports open ledger items
  // that name one of the repository's own clinical eval cases -- not "every
  // clinical answer problem", which it has no way to know. A panel on a clinical
  // system that implies coverage it does not have is worse than no panel, so the
  // narrower name is deliberate and should not be "improved" into a broader one.
  // Moved here from the On Call home on the owner's instruction (2026-09-16).
  // A strip naming overdue sections was built on that page first: it is a
  // maintenance fact, and the person reading the On Call home is mid-shift and
  // after a phone number. Live rather than snapshot-backed, because staleness
  // is derived at read time and never stored.
  {
    id: "on-call-freshness",
    name: "On Call freshness",
    summary: "Entries never confirmed, or last confirmed over twelve months ago",
    group: "clinical",
    phase: 1,
    href: "/admin/developer-hub/on-call-freshness",
  },
  {
    id: "clinical-answer-failures",
    name: "Answer failures",
    summary: "Open problems recorded against a named clinical question",
    group: "clinical",
    phase: 1,
    href: "/admin/developer-hub/clinical-answer-failures",
  },
  // Kept, unlike the five removed above, and settled: the owner ruled on
  // 2026-08-26 that the hazard register belongs in the developer hub rather
  // than as a separate clinical-safety surface. It was never a removal
  // candidate on the Ruling R1 ground the five removed entries failed on --
  // it restates no fact an existing green gate already guarantees. Do not
  // drop it in a later placeholder sweep; it is unbuilt, not unwanted.
  // Built 2026-09-08. The summary names what the page can actually show: the
  // registers this repository holds. It deliberately does not say "every clinical risk" -- three of the
  // four rows with no control are reviews nobody has convened, so a register
  // claiming completeness would be the first thing on the hub that is untrue.
  {
    id: "hazard-register",
    name: "Hazard register",
    summary: "Known clinical risks, their controls, and the ones nothing controls yet",
    group: "clinical",
    phase: 1,
    href: "/admin/developer-hub/hazards",
  },
  // Named for the question it answers -- what is waiting on a person -- and
  // scoped to the seven record families this repository holds on disk. It is a
  // read-only aggregation: the page publishes, approves and unhides nothing, and
  // the summary must never imply otherwise. It deliberately does not say "all"
  // or "every clinical record": a family whose review state lives somewhere this
  // repository does not hold would be invisible to it, and a queue claiming
  // completeness is exactly the claim a reviewer would trust and should not.
  {
    id: "clinical-sign-off",
    name: "Clinical sign-off queue",
    summary: "Records waiting on a person, in the review vocabulary each one uses",
    group: "clinical",
    phase: 1,
    href: "/admin/developer-hub/clinical-sign-off",
  },

  // No `environment` card: the environment strip renders as its own section on
  // the hub, so a card pointing at `#developer-hub-environment` would be a
  // self-link, not a destination. No `database-drift` card either — see the
  // removal comment above; a phase-3 "coming soon" would promise a panel the
  // plan records as never to be built.
  {
    id: "ingestion",
    name: "Ingestion",
    summary: "Stuck, failed, and queued document jobs",
    group: "system",
    phase: 1,
    href: "/admin/developer-hub/ingestion",
  },
  // Named for the question it answers -- which of my documents are broken -- and
  // scoped to that. The ingestion card above shows documents *moving*; this one
  // shows the library at rest, which is where a document that finished and
  // produced nothing usable hides. It reports what indexing produced, never
  // whether an answer drawn from those documents is any good, and the page says
  // so; do not widen the summary into a claim about answer quality.
  {
    id: "corpus-health",
    name: "Corpus health",
    summary: "Documents that finished indexing and produced nothing usable",
    group: "system",
    phase: 1,
    href: "/admin/developer-hub/corpus-health",
  },
  // Live and administrator-only: it reads the running server's settings on each
  // request and shows only Set/Missing/On/Off or an allow-listed mode name. The
  // summary promises "never the values"; keep it that way.
  {
    id: "settings-check",
    name: "Settings check",
    summary: "Whether each production switch is on and each secret is in place — never the values",
    group: "system",
    phase: 1,
    href: "/admin/developer-hub/settings",
  },
  // `work-in-flight` (Review state), `test-health`, `documentation` and `routes`
  // were retired 2026-09-26 on the owner's decision (see mockups/README.md,
  // "Retired developer-gated routes"): engineering views the owner does not use.
  // Their data still lives in data/repo-awareness-snapshot.json.
  // A static sheet, not a route: it is the generated brand preview, mirrored
  // from docs/brand/preview.html into public/ so the hub can link to it.
  // `tests/developer-hub-panels.test.ts` holds the two copies byte-identical,
  // so the link can never show a stale mark.
  {
    id: "brand",
    name: "Brand and design",
    summary: "The mark's construction, every size and lockup, clear space and misuse",
    group: "reference",
    phase: 1,
    href: "/brand/preview.html",
    external: true,
  },
  // Real prototype cards, not one generic self-linking "Prototypes" card.
  // This is also what preserves the Care Plan entry the spec requires to
  // survive the hub rewrite.
  {
    id: "care-plan",
    name: "Care Plan",
    // #L76: this described the August (pre-Task 10-11) state, before
    // Reviews/Team/Governance (operations-pages.tsx: ReviewsSurface,
    // TeamSurface, GovernanceSurface) and the Patient Plan route became
    // functional. Kept accurate to what the prototype actually covers now.
    summary:
      "Synthetic, memory-only prototype: Management Plan, ED Presentations, Personal Safety Plan, Patient Plan, Reviews/Team/Governance",
    group: "reference",
    phase: 1,
    href: "/mockups/care-plan",
  },
];

export function panelsInGroup(group: HubPanelGroup): HubPanel[] {
  return HUB_PANELS.filter((panel) => panel.group === group);
}
