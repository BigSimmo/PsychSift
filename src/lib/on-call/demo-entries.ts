import { type OnCallEntry } from "@/lib/on-call/entry-model";
import { ON_CALL_HOME_TAGS } from "@/lib/on-call/home-modules";

/**
 * The demo shift.
 *
 * Two fixture rows used to stand in for this whole mode, which meant demo mode
 * showed a hub with no call cards, no wards, no reminder, no sections worth
 * opening — a visitor saw the empty state of every screen and learned nothing
 * about what On Call is for. It also left the eleven artboards untestable in a
 * browser: you cannot assert that a drawn module renders when there is no data
 * that would make it render.
 *
 * So this is a whole synthetic shift, sized to exercise every element of the
 * drawing: two call-first contacts and a switchboard, four wards, a pinned
 * escalation, dated teaching, tagged referrals, orientation folders and
 * checklists, the six Admin folders, a wholly private one, every Compliance
 * consequence band — all of them private — and role explainers.
 *
 * **Everything here must stay obviously synthetic.** Every employer is "Demo",
 * every number is a run of zeroes with a single distinguishing digit, every
 * link is `example.org`, and nothing states a clinical fact — no dose, no
 * threshold, no criterion. A demo corpus that looks real is worse than an empty
 * one: it is a hospital directory a visitor might act on. The playbook entry
 * below is escalation only, which is what THE PLAYBOOK RULE permits it to be.
 *
 * The exception is the names of the bodies that actually issue a requirement —
 * Ahpra, RANZCP, the Department of Communities. A compliance row whose issuer
 * read "Demo registration board" would teach a visitor the wrong word for the
 * one thing this page exists to help them chase, and `issuingBody` carries no
 * contact detail: it is recorded so the holder knows who to ask.
 *
 * **No row may say a requirement is held, current, valid or in order.** Nothing
 * here — and nothing in the real data this stands in for — is checked with an
 * issuing body, so the corpus states what was recorded, who issues it, and how
 * the date came to be believed, and leaves the verdict to the reader.
 *
 * **Every compliance row is private**, which is a property of the real data
 * and not a fixture convenience — a doctor's registration, indemnity and
 * clearances are not the ward numbers the shared read was opened up for. The
 * reasoning sits with the rows themselves, at the Compliance block below.
 */

/** Recognisably fake, and consistent: `0000 000 00N`. */
function demoNumber(n: number): string {
  return `0000 000 0${`${n}`.padStart(2, "0")}`;
}

/**
 * A second bank of placeholder numbers, under the same rule as `demoNumber`.
 *
 * `demoNumber` puts its distinguishing digit last, which yields only eighteen
 * usable values — 1-9 and the round tens — before a second non-zero digit
 * appears and the corpus guard rightly rejects the result (see
 * `tests/on-call-demo-entries.test.ts`, "keeps every number obviously fake").
 * This one moves the digit rather than adding one, so the directory can grow
 * without either repeating a number or producing something that reads like a
 * line which rings.
 */
function demoNumberAlt(n: number): string {
  return `0000 ${n}00 000`;
}

function id(n: number): string {
  return `00000000-0000-4000-8000-${`${n}`.padStart(12, "0")}`;
}

/**
 * Dated relative to the day the page is read, so "Coming up" is never empty and
 * never shows a session in the past. Built at UTC noon for the same reason
 * `weekdayLabel` is: a bare date must not shift a day under a timezone.
 */
function demoDateKey(daysAhead: number): string {
  const day = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return `${day.getUTCFullYear()}-${`${day.getUTCMonth() + 1}`.padStart(2, "0")}-${`${day.getUTCDate()}`.padStart(2, "0")}`;
}

type DemoEntry = Omit<OnCallEntry, "createdAt" | "updatedAt">;

function entry(row: DemoEntry): OnCallEntry {
  return row as OnCallEntry;
}

/** Never verified, so the freshness badge and the "needs checking" group both appear. */
const NEVER_VERIFIED = null;
const VERIFIED_RECENTLY = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

export const DEMO_ON_CALL_ENTRIES: readonly OnCallEntry[] = [
  // ---- Contacts: the home's call cards, switchboard and ward strip ----
  entry({
    id: id(1),
    section: "contacts",
    slug: "demo-nurse-manager",
    title: "Nurse manager, after hours",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: { role: "Nurse manager", phone: demoNumber(1), availability: "Always" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.callFirst, "Tonight"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(2),
    section: "contacts",
    slug: "demo-registrar-on-call",
    title: "Registrar on call",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: { role: "Registrar on call", phone: demoNumber(2), availability: "From 17:00" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.callFirst, "Tonight"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(3),
    section: "contacts",
    slug: "demo-switchboard",
    title: "Hospital switchboard",
    subtitle: "For the consultant, and anyone off this list",
    body: null,
    details: { role: "Switchboard operator", phone: demoNumber(9) },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.switchboard, "Tonight"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(4),
    section: "contacts",
    slug: "demo-ward-one",
    title: "Ward One",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Ward nurses' station", extension: "0001" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(5),
    section: "contacts",
    slug: "demo-ward-two",
    title: "Ward Two",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Ward nurses' station", extension: "0002" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(6),
    section: "contacts",
    slug: "demo-emergency-department",
    title: "Emergency Department",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Emergency department", extension: "0003" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(7),
    section: "contacts",
    slug: "demo-interpreter-line",
    title: "Interpreter line",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: { role: "Interpreter service", phone: demoNumber(4), availability: "24 hours" },
    linkedDocumentIds: [],
    tags: ["Services"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(8),
    section: "contacts",
    slug: "demo-bed-management",
    title: "Bed management, after hours",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: { role: "Bed management", phone: demoNumber(5) },
    linkedDocumentIds: [],
    tags: ["Admin"],
    isPersonal: false,
    includeOnCard: false,
    // Never confirmed, so the "needs checking" group and the overdue badge both
    // have something to show.
    sortOrder: 7,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(9),
    section: "contacts",
    slug: "demo-private-line",
    title: "Private line",
    subtitle: "Example private entry shown in demo mode",
    body: null,
    details: { role: "Example personal contact", phone: demoNumber(6) },
    linkedDocumentIds: [],
    tags: ["Tonight"],
    // The one private row, so the "Private · only you" treatment — flag shown,
    // digits withheld — is visible in demo mode rather than only in a test.
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 8,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Contacts, continued: enough wards to make the strip scroll, and the
  // three number fields the one-line rows above never exercise ----
  //
  // `ON_CALL_WARD_STRIP_LIMIT` is eight, and three wards never showed what the
  // strip does when it has to scroll. These take it to six. The rest carry a
  // `pager`, an `afterHoursPhone` and an `availability` window, each of which
  // renders differently from a bare `phone` and none of which appeared in the
  // corpus before — a field with no demo row is a field nobody sees until a
  // real one is typed into it.
  entry({
    id: id(12),
    section: "contacts",
    slug: "demo-ward-three",
    title: "Ward Three",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Ward nurses' station", extension: "0004" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 9,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(13),
    section: "contacts",
    slug: "demo-high-dependency-unit",
    title: "High dependency unit",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Ward nurses' station", extension: "0005" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 10,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(14),
    section: "contacts",
    slug: "demo-older-adult-ward",
    title: "Older adult ward",
    subtitle: "Nurses' station",
    body: null,
    details: { role: "Ward nurses' station", extension: "0006" },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.ward, "Wards"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 11,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(15),
    section: "contacts",
    slug: "demo-consultant-on-call",
    title: "Consultant on call",
    subtitle: "Through switchboard first, this number second",
    body: null,
    // The only row carrying a pager, so the pager line on a contact row is
    // visible in a browser rather than only in the schema.
    details: {
      role: "Consultant on call",
      phone: demoNumber(30),
      pager: "0007",
      availability: "Overnight and weekends",
    },
    linkedDocumentIds: [],
    tags: ["Tonight"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 12,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(16),
    section: "contacts",
    slug: "demo-pharmacy",
    title: "Pharmacy",
    subtitle: "Two numbers, and they are not the same one",
    body: null,
    // The only row with both a daytime and an after-hours number, which is the
    // case the two-number layout exists for.
    details: {
      role: "Pharmacy",
      phone: demoNumber(40),
      afterHoursPhone: demoNumber(50),
      availability: "On site until 17:00",
    },
    linkedDocumentIds: [],
    tags: ["Services"],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 13,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(17),
    section: "contacts",
    slug: "demo-patient-transport",
    title: "Patient transport",
    subtitle: "Booking line",
    body: null,
    details: { role: "Patient transport", phone: demoNumber(60), availability: "24 hours" },
    linkedDocumentIds: [],
    tags: ["Services"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 14,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(18),
    section: "contacts",
    slug: "demo-social-work-after-hours",
    title: "Social work, after hours",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: { role: "Social work", phone: demoNumber(70), availability: "From 17:00" },
    linkedDocumentIds: [],
    tags: ["Services"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 15,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(19),
    section: "contacts",
    slug: "demo-medical-workforce-unit",
    title: "Medical workforce unit",
    subtitle: "Rosters, leave and pay — the people, not the building",
    body: null,
    // Tagged Services, not Admin, and that is a constraint rather than a
    // preference. The Contacts page groups by tag and its bar is the drawing's
    // three words — Services, Tonight, Wards — which `ui-on-call-boards.spec.ts`
    // asserts exactly, at two widths. "Admin" exists as a contacts tag (Demo bed
    // management carries it) but produces no group today, because that row is
    // never-verified and files under "needs checking" instead. A VERIFIED Admin
    // row is therefore what makes a fourth group appear, and a fourth group is a
    // change to the drawing, not a fixture decision. A workforce desk is a
    // number you ring, which is what Services holds.
    details: {
      role: "Medical workforce",
      phone: demoNumber(80),
      contactName: "Workforce officer",
      availability: "Weekdays, business hours",
    },
    linkedDocumentIds: [],
    tags: ["Services"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 16,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Who's who: role explainers, filed in contacts ----
  entry({
    id: id(10),
    section: "contacts",
    slug: "demo-role-registrar",
    title: "What the registrar on call does",
    subtitle: "Anything you cannot settle with the nurse in charge",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "Registrar on call", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(11),
    section: "contacts",
    slug: "demo-role-consultant",
    title: "What the consultant on call does",
    subtitle: "Decisions the registrar cannot make alone",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "Consultant on call", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Five more role explainers, because two made Who's who look like a pair of
  // footnotes rather than the page it is. A junior doctor covering a first
  // night does not need the registrar's number so much as the sentence saying
  // when ringing the registrar is the right thing to do — that is what this
  // page holds, and it only reads as such once the whole ladder is on it.
  entry({
    id: id(100),
    section: "contacts",
    slug: "demo-role-nurse-in-charge",
    title: "What the nurse in charge does",
    subtitle: "Your first call for almost everything on the ward",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "Nurse in charge", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(101),
    section: "contacts",
    slug: "demo-role-resident",
    title: "What the resident covering the wards does",
    subtitle: "The other doctor in the building overnight",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "Resident medical officer", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(102),
    section: "contacts",
    slug: "demo-role-duty-manager",
    title: "What the after-hours duty manager does",
    subtitle: "Beds, staffing and anything that is not a patient",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "After-hours duty manager", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(103),
    section: "contacts",
    slug: "demo-role-medical-workforce",
    title: "What medical workforce does",
    subtitle: "Your roster, your leave and your pay — not a clinical desk",
    body: "Placeholder role description shown only in demo mode.",
    // The counterpart to the Admin section: Admin holds the forms, this says
    // whose desk they land on. The pair is the whole reason Admin and
    // Compliance were split out of one "logistics" list.
    details: { role: "Medical workforce", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(104),
    section: "contacts",
    slug: "demo-role-director-of-training",
    title: "What the director of training does",
    subtitle: "Supervision, teaching and progression through the programme",
    body: "Placeholder role description shown only in demo mode.",
    details: { role: "Director of training", kind: "role-explainer" },
    linkedDocumentIds: [],
    tags: ["Roles"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Playbook: the pinned reminder, a ladder, and one with no guideline ----
  entry({
    id: id(20),
    section: "playbook",
    slug: "demo-escalation-pinned",
    title: "You are expected to wake the demo consultant.",
    subtitle: "Any decision the registrar cannot make alone. The Playbook has the ladder.",
    body: null,
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        { order: 1, whoToCall: "Nurse in charge, on the ward", when: "First, before any call." },
        {
          order: 2,
          whoToCall: "Registrar on call",
          when: "If it is unresolved after five minutes.",
          phone: demoNumber(2),
        },
        {
          order: 3,
          whoToCall: "Consultant on call",
          when: "If the registrar is unreachable for ten minutes. You are expected to make this call.",
          phone: demoNumber(9),
        },
      ],
    },
    linkedDocumentIds: [],
    tags: [ON_CALL_HOME_TAGS.pinned],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(21),
    section: "playbook",
    slug: "demo-escalation-second",
    title: "Systems unavailable",
    subtitle: null,
    body: null,
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        { order: 1, whoToCall: "Ward clerk", when: "First." },
        { order: 2, whoToCall: "IT service desk", when: "If it is still down after ten minutes." },
      ],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Four more ladders. Two was enough to prove a ladder renders and not enough
  // to show what the Playbook is: a shelf of the handful of situations that
  // actually generate an overnight call, each answered by who to ring and in
  // what order. Escalation only — THE PLAYBOOK RULE — so every trigger below
  // is a staffing, bed, safety or process problem, and none of them says what
  // to do for a patient.
  entry({
    id: id(22),
    section: "playbook",
    slug: "demo-escalation-registrar-unreachable",
    title: "Registrar not answering",
    subtitle: "Do not sit on this one",
    body: null,
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        { order: 1, whoToCall: "Registrar on call", when: "Twice, five minutes apart.", phone: demoNumber(2) },
        {
          order: 2,
          whoToCall: "Hospital switchboard",
          when: "Ask them to page and to confirm the page went.",
          phone: demoNumber(9),
        },
        {
          order: 3,
          whoToCall: "Consultant on call",
          // NOT "You are expected to make this call". That sentence belongs to
          // the pinned reminder, and `ui-on-call-boards.spec.ts` locates it by
          // text — a second copy makes the locator ambiguous and the board
          // assertion fails on a strict-mode violation rather than on anything
          // being wrong with the page.
          when: "If there is still no answer. Do not keep waiting on the registrar.",
          phone: demoNumber(30),
        },
      ],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(23),
    section: "playbook",
    slug: "demo-escalation-no-bed",
    title: "No bed after hours",
    subtitle: null,
    body: null,
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        { order: 1, whoToCall: "Bed management, after hours", when: "First.", phone: demoNumber(5) },
        { order: 2, whoToCall: "After-hours duty manager", when: "If nothing is found within the hour." },
        {
          order: 3,
          whoToCall: "Consultant on call",
          when: "Before any decision that leaves someone waiting overnight.",
          phone: demoNumber(30),
        },
      ],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(24),
    section: "playbook",
    slug: "demo-escalation-security-incident",
    title: "Safety incident on the ward",
    subtitle: "Security first, then the people who have to know",
    body: null,
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        { order: 1, whoToCall: "Security escort", when: "Immediately.", phone: demoNumber(3) },
        { order: 2, whoToCall: "Nurse in charge, on the ward", when: "As soon as the area is safe." },
        { order: 3, whoToCall: "After-hours duty manager", when: "Same shift, not the next morning." },
        { order: 4, whoToCall: "Consultant on call", when: "Same shift.", phone: demoNumber(30) },
      ],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(25),
    section: "playbook",
    slug: "demo-escalation-complaint-overnight",
    title: "Complaint overnight",
    subtitle: "A ladder with no phone numbers on it, which is allowed",
    body: null,
    // Deliberately numberless: an escalation step is a person and a moment,
    // and the row has to read properly when the owner has not recorded a
    // number for any of them.
    details: {
      trigger: "Example escalation scenario shown in demo mode",
      escalationSteps: [
        {
          order: 1,
          whoToCall: "Nurse in charge, on the ward",
          when: "Listen and write it down. Nothing else tonight.",
        },
        { order: 2, whoToCall: "After-hours duty manager", when: "Before the end of the shift." },
      ],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Referrals: tagged, so the chip row has something to filter ----
  entry({
    id: id(30),
    section: "referrals",
    slug: "demo-community-team",
    title: "Community mental health team",
    subtitle: "Weekdays only",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      catchment: "Catchment",
      hours: "Weekdays, business hours",
      howToRefer: "Placeholder referral process shown only in demo mode.",
      phone: demoNumber(7),
    },
    linkedDocumentIds: [],
    tags: ["Community"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(31),
    section: "referrals",
    slug: "demo-youth-service",
    title: "Youth service",
    subtitle: "Seven days",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      hours: "Seven days",
      phone: demoNumber(8),
    },
    linkedDocumentIds: [],
    tags: ["Youth"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Six more services, filed into four groups rather than two.
  //
  // FOUR GROUPS, NOT SIX, and that is a measured limit rather than a taste.
  // The page's group bar is a `wordmark-five` band: at five items every word
  // shows, and the sixth collapses the row into four words plus a "More".
  // `tests/ui-on-call-boards.spec.ts` asserts the bar still offers
  // "Community", so a fifth and sixth group here would push the assertion's
  // own word into an overflow menu. A service that needs a new group needs
  // the bar widened first.
  //
  // `accepts` and `exclusions` stay placeholder strings throughout. Who a
  // service takes is the one thing on this page a reader would act on, and a
  // demo corpus is the last place that should be answered — the shape of the
  // row is what these rows are for.
  entry({
    id: id(32),
    section: "referrals",
    slug: "demo-adult-community-team",
    title: "Adult community team, north",
    subtitle: "The one with a form rather than a phone call",
    body: null,
    // The only row carrying a form link and a fax, so both render somewhere a
    // browser can see them.
    details: {
      accepts: [
        "Example acceptance criterion shown in demo mode",
        "Second example acceptance criterion shown in demo mode",
      ],
      exclusions: ["Example exclusion shown in demo mode"],
      catchment: "Catchment, north",
      hours: "Weekdays, business hours",
      howToRefer: "Placeholder referral process shown only in demo mode.",
      phone: demoNumber(90),
      fax: demoNumberAlt(5),
      referralFormUrl: "https://example.org/demo-referral-form",
    },
    linkedDocumentIds: [],
    tags: ["Community"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(33),
    section: "referrals",
    slug: "demo-community-outreach-team",
    title: "Community outreach team",
    subtitle: "Goes to people who will not come in",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      catchment: "Catchment, whole service",
      hours: "Seven days, daytime",
      phone: demoNumberAlt(1),
    },
    linkedDocumentIds: [],
    tags: ["Community"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(34),
    section: "referrals",
    slug: "demo-youth-after-hours-line",
    title: "Youth after-hours line",
    subtitle: "The one that answers overnight",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      hours: "Overnight, seven days",
      howToRefer: "Placeholder referral process shown only in demo mode.",
      phone: demoNumberAlt(2),
    },
    linkedDocumentIds: [],
    tags: ["Youth"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(35),
    section: "referrals",
    slug: "demo-older-adult-team",
    title: "Older adult team",
    subtitle: "Weekdays only",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      catchment: "Catchment",
      hours: "Weekdays, business hours",
      phone: demoNumberAlt(3),
    },
    linkedDocumentIds: [],
    tags: ["Older"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(36),
    section: "referrals",
    slug: "demo-memory-service",
    title: "Memory service",
    subtitle: "Referral by letter, not by phone",
    body: null,
    // No phone at all, which is the case the row has to survive: a service
    // reached only in writing must not render as a blank dial button.
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      hours: "Weekdays, business hours",
      howToRefer: "Placeholder referral process shown only in demo mode.",
      referralFormUrl: "https://example.org/demo-memory-service-referral",
    },
    linkedDocumentIds: [],
    tags: ["Older"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(37),
    section: "referrals",
    slug: "demo-perinatal-service",
    title: "Perinatal service",
    subtitle: "Example entry shown in demo mode",
    body: null,
    details: {
      accepts: ["Example acceptance criterion shown in demo mode"],
      exclusions: ["Example exclusion shown in demo mode"],
      catchment: "Catchment",
      hours: "Weekdays, business hours",
      phone: demoNumberAlt(4),
    },
    linkedDocumentIds: [],
    tags: ["Perinatal"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 7,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Orientation: folders, two checklists, and one manual left unfiled ----
  //
  // `details.category` is the folder heading. It is optional in the schema
  // because orientation rows already existed without one, so the last row here
  // carries none on purpose: a row with no folder is the only thing that puts
  // the fallback heading ("Unfiled") on screen, and an unexercised fallback is
  // one nobody notices has broken.
  //
  // One word per folder, like the Admin block below and for the same measured
  // reason: the folder is a slot in a 48px bar of bare words, where a phrase
  // truncates on a 320px phone. The manual titled "Before you leave" keeps that
  // title on its own card; only the folder above it is shortened to
  // "Departure".
  entry({
    id: id(40),
    section: "orientation",
    slug: "demo-first-fifteen-minutes",
    title: "Your first fifteen minutes",
    subtitle: "Example checklist shown in demo mode",
    body: "Placeholder orientation note shown only in demo mode.",
    details: {
      pinnedSummaryIsOwnerNote: true,
      category: "Induction",
      checklist: [
        { text: "Collect the on-call phone", note: "Ward One nurses' station" },
        { text: "Introduce yourself to the nurse in charge" },
        { text: "Check your keycard opens the on-call room" },
      ],
    },
    linkedDocumentIds: [],
    tags: ["Starting"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(42),
    section: "orientation",
    slug: "demo-ward-one-manual",
    title: "Ward One manual",
    subtitle: "How the ward runs its own day",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Manuals" },
    linkedDocumentIds: [],
    tags: ["Wards"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(43),
    section: "orientation",
    slug: "demo-emergency-department-manual",
    title: "Emergency Department manual",
    subtitle: "Who to find, and where the assessment rooms are",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Manuals" },
    linkedDocumentIds: [],
    tags: ["Wards"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(44),
    section: "orientation",
    slug: "demo-after-hours-policy-index",
    title: "After-hours policy index",
    subtitle: "Example index shown in demo mode",
    body: "Placeholder pointer shown only in demo mode. The policies themselves live in your own documents.",
    details: { pinnedSummaryIsOwnerNote: true, category: "Policies" },
    linkedDocumentIds: [],
    tags: ["Policies"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(41),
    section: "orientation",
    slug: "demo-before-you-leave",
    title: "Before you leave",
    subtitle: "Example checklist shown in demo mode",
    body: null,
    details: {
      pinnedSummaryIsOwnerNote: true,
      category: "Departure",
      checklist: [
        { text: "Return the on-call phone and pager" },
        { text: "Hand back the keycard", note: "Not doing this is what gets chased for months." },
        { text: "Finish outstanding notes" },
      ],
    },
    linkedDocumentIds: [],
    tags: ["Finishing"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(45),
    section: "orientation",
    slug: "demo-orientation-handbook",
    title: "Orientation handbook",
    subtitle: "The whole-of-service one, sent before you start",
    body: null,
    // Deliberately unfiled — see the note at the top of this block.
    details: { pinnedSummaryIsOwnerNote: true },
    linkedDocumentIds: [],
    tags: ["Starting"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Seven more shelves, so each folder holds a shelf rather than a single
  // item.
  //
  // A folder with one thing in it does not read as a folder — it reads as a
  // heading somebody forgot to delete, and that is what Orientation looked
  // like with six rows across four folders plus the unfiled one. Manuals in
  // particular is the folder the section is named for, and one ward manual
  // does not show that the shelf is per-ward. The folder names themselves are
  // fixed by `ORIENTATION_CATEGORY_OPTIONS` in the editor and nothing here
  // invents a new one.
  entry({
    id: id(46),
    section: "orientation",
    slug: "demo-induction-week-timetable",
    title: "Induction week timetable",
    subtitle: "What is on, and which of it is compulsory",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Induction" },
    linkedDocumentIds: [],
    tags: ["Starting"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(47),
    section: "orientation",
    slug: "demo-first-week-checklist",
    title: "Your first week",
    subtitle: "Example checklist shown in demo mode",
    body: "Placeholder orientation note shown only in demo mode.",
    // The third checklist in the corpus. Two proved the control renders; three
    // in two different folders shows that a checklist is a property of a
    // shelf rather than a property of one folder.
    details: {
      pinnedSummaryIsOwnerNote: true,
      category: "Induction",
      checklist: [
        { text: "Finish the compulsory induction modules", note: "They gate your logins." },
        { text: "Meet your supervisor and agree a supervision time" },
        { text: "Find the on-call room and the after-hours entrance" },
        { text: "Check your name is on the roster you think you are on" },
      ],
    },
    linkedDocumentIds: [],
    tags: ["Starting"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 7,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(48),
    section: "orientation",
    slug: "demo-ward-two-manual",
    title: "Ward Two manual",
    subtitle: "How the ward runs its own day",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Manuals" },
    linkedDocumentIds: [],
    tags: ["Wards"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 8,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(49),
    section: "orientation",
    slug: "demo-high-dependency-unit-manual",
    title: "High dependency unit manual",
    subtitle: "Staffing, handover times and who runs the round",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Manuals" },
    linkedDocumentIds: [],
    tags: ["Wards"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 9,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(110),
    section: "orientation",
    slug: "demo-older-adult-ward-manual",
    title: "Older adult ward manual",
    subtitle: "How the ward runs its own day",
    body: null,
    details: { pinnedSummaryIsOwnerNote: true, category: "Manuals" },
    linkedDocumentIds: [],
    tags: ["Wards"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 10,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(111),
    section: "orientation",
    slug: "demo-after-hours-escalation-policy",
    title: "After-hours escalation policy",
    subtitle: "The written version of what the Playbook shows as a ladder",
    body: "Placeholder pointer shown only in demo mode. The policy itself lives in your own documents.",
    details: { pinnedSummaryIsOwnerNote: true, category: "Policies" },
    linkedDocumentIds: [],
    tags: ["Policies"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 11,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(112),
    section: "orientation",
    slug: "demo-end-of-rotation-handover",
    title: "End of rotation handover",
    subtitle: "Example checklist shown in demo mode",
    body: null,
    details: {
      pinnedSummaryIsOwnerNote: true,
      category: "Departure",
      checklist: [
        { text: "Write the handover for whoever takes the list" },
        { text: "Close or reassign anything still open in your name" },
        { text: "Ask for your term assessment before you leave", note: "Chasing it afterwards takes months." },
      ],
    },
    linkedDocumentIds: [],
    tags: ["Finishing"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 12,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Teaching: dated, so "Coming up" has something to rank ----
  entry({
    id: id(50),
    section: "education",
    slug: "demo-registrar-teaching",
    title: "Registrar teaching",
    subtitle: "Example session shown in demo mode",
    body: null,
    details: {
      recurrence: "Weekly in term",
      nextOccurrence: "08:00",
      nextOccurrenceDate: demoDateKey(3),
      location: "Seminar room",
      presenter: "Presenter",
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(51),
    section: "education",
    slug: "demo-journal-club",
    title: "Journal club",
    subtitle: "Example session shown in demo mode",
    body: null,
    details: {
      recurrence: "Monthly",
      nextOccurrence: "13:00",
      nextOccurrenceDate: demoDateKey(12),
      location: "Seminar room",
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Five more sessions, so the Teaching page is a term rather than a pair.
  //
  // Between them they carry every field the section has: a structured
  // `recurrenceRule` that the home rolls forward, a one-off with no rule at
  // all, a `presenter`, a `recordingUrl` and a list of `topics`. The dates are
  // relative to today for the same reason the two above are — the corpus has
  // to still show a term when it is read a year from now.
  entry({
    id: id(52),
    section: "education",
    slug: "demo-case-conference",
    title: "Case conference",
    subtitle: "Example session shown in demo mode",
    body: null,
    details: {
      recurrence: "Weekly in term, except the first week back",
      nextOccurrence: "12:30",
      nextOccurrenceDate: demoDateKey(1),
      recurrenceRule: { frequency: "weekly" },
      location: "Seminar room",
      presenter: "Presenter",
      topics: ["Example topic shown in demo mode"],
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(53),
    section: "education",
    slug: "demo-exam-preparation-group",
    title: "Exam preparation group",
    subtitle: "Runs fortnightly through the year",
    body: null,
    details: {
      recurrence: "Fortnightly",
      nextOccurrence: "17:00",
      nextOccurrenceDate: demoDateKey(8),
      recurrenceRule: { frequency: "fortnightly" },
      location: "Tutorial room",
      topics: ["Example topic shown in demo mode", "Second example topic shown in demo mode"],
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(54),
    section: "education",
    slug: "demo-grand-rounds",
    title: "Grand rounds",
    subtitle: "Recorded, so it can be watched later",
    body: null,
    // The only session with a recording link, which is a different control
    // from a location and has to be seen next to one.
    details: {
      recurrence: "Monthly",
      nextOccurrence: "12:00",
      nextOccurrenceDate: demoDateKey(18),
      recurrenceRule: { frequency: "monthly" },
      location: "Lecture theatre",
      presenter: "Presenter",
      recordingUrl: "https://example.org/demo-grand-rounds-recording",
      topics: ["Example topic shown in demo mode"],
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(55),
    section: "education",
    slug: "demo-simulation-afternoon",
    title: "Simulation afternoon",
    subtitle: "Once a term, and it is not repeated",
    body: null,
    // A one-off: dated, but with no `recurrenceRule`, so the roll-forward
    // leaves it alone and it drops off the home once its date passes. That is
    // the behaviour the rule exists to distinguish, and it needs a row.
    details: {
      recurrence: "Once a term",
      nextOccurrence: "13:00",
      nextOccurrenceDate: demoDateKey(40),
      location: "Simulation suite",
      presenter: "Presenter",
    },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(56),
    section: "education",
    slug: "demo-supervision-hour",
    title: "Supervision hour",
    subtitle: "Yours to arrange with your supervisor",
    body: "Placeholder note shown only in demo mode.",
    // Undated on purpose. An undated session still belongs on the Teaching
    // page and simply cannot be ranked on the home — the one case the
    // optionality of `nextOccurrenceDate` exists for.
    details: { recurrence: "Weekly, by arrangement" },
    linkedDocumentIds: [],
    tags: ["Teaching"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: NEVER_VERIFIED,
  }),

  // ---- Admin: the work admin a doctor does for themselves ----
  //
  // The section id is still `logistics` and always will be — it is a database
  // CHECK constraint — but what it holds is now leave, rosters, pay, forms and
  // access, with Facilities kept as one folder so the rooms-and-food rows that
  // predate the change are not orphaned.
  //
  // ONE WORD PER CATEGORY, and this corpus is where that convention is modelled
  // in a browser. `category` is the group heading AND a slot in the page's
  // in-page navigation bar, which draws bare words that truncate rather than
  // fold (`wordmark-five` in src/components/mode-nav/mode-nav-bands.ts). "What
  // you can authorise" measured 165px in that row against a 288px phone
  // viewport and was cut to "Authorise" — see `tests/ui-on-call-boards.spec.ts`
  // (board 11), which is the record of the measurement.
  //
  // A phrase reads fine in review and truncates on the phone this mode is
  // opened on at 3am, so "Rosters and hours" is "Rosters", "Pay and claims" is
  // "Pay", and "IT and access" is "Access". If a folder seems to need a phrase,
  // the answer is a better word, not a wider bar. The editor's
  // `ADMIN_CATEGORY_OPTIONS` is the same list and carries the same note.
  entry({
    id: id(66),
    section: "logistics",
    slug: "demo-sick-leave",
    title: "Sick leave, and who to tell first",
    subtitle: "Before the shift starts, wherever that is possible",
    body: "Placeholder administrative note shown only in demo mode.",
    details: { category: "Leave", url: "https://example.org/demo-sick-leave" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(67),
    section: "logistics",
    slug: "demo-professional-development-leave",
    title: "Professional development leave (PDL)",
    subtitle: "How to apply, and what the allowance covers",
    body: null,
    details: { category: "Leave", url: "https://example.org/demo-pdl" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(68),
    section: "logistics",
    slug: "demo-annual-and-parental-leave",
    title: "Annual and parental leave",
    subtitle: "How far ahead a request has to go in",
    body: null,
    details: { category: "Leave" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(69),
    section: "logistics",
    slug: "demo-roster-requests",
    title: "Roster requests and shift swaps",
    subtitle: "Who approves a swap, and by when",
    body: null,
    details: { category: "Rosters", hours: "Weekdays, business hours", phone: demoNumber(10) },
    linkedDocumentIds: [],
    tags: ["Roster"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(70),
    section: "logistics",
    slug: "demo-overtime-and-toil",
    title: "Overtime and time off in lieu (TOIL)",
    subtitle: "What to record, and where it goes",
    body: null,
    details: { category: "Rosters" },
    linkedDocumentIds: [],
    tags: ["Roster"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(65),
    section: "logistics",
    slug: "demo-taxi-home",
    title: "A taxi home after a night shift",
    subtitle: "Yours to authorise in this demo",
    body: "Placeholder fatigue note shown only in demo mode.",
    details: { category: "Rosters" },
    linkedDocumentIds: [],
    tags: ["Roster"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(71),
    section: "logistics",
    slug: "demo-payslips",
    title: "Payslips and pay queries",
    subtitle: null,
    body: null,
    details: { category: "Pay", hours: "Weekdays, business hours", phone: demoNumber(20) },
    linkedDocumentIds: [],
    tags: ["Pay"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(72),
    section: "logistics",
    slug: "demo-on-call-allowance",
    title: "On-call allowance and overtime claims",
    subtitle: "Claim in the fortnight you worked it",
    body: null,
    details: { category: "Pay" },
    linkedDocumentIds: [],
    tags: ["Pay"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 7,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(73),
    section: "logistics",
    slug: "demo-salary-packaging",
    title: "Salary packaging and reimbursements",
    subtitle: null,
    body: null,
    details: { category: "Pay", url: "https://example.org/demo-salary-packaging" },
    linkedDocumentIds: [],
    tags: ["Pay"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 8,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(74),
    section: "logistics",
    slug: "demo-forms-index",
    title: "Where the demo forms live",
    subtitle: "One index, so nothing is hunted for twice",
    body: null,
    details: { category: "Forms", url: "https://example.org/demo-forms" },
    linkedDocumentIds: [],
    tags: ["Forms"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 9,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(75),
    section: "logistics",
    slug: "demo-leave-application-form",
    title: "Leave application form",
    subtitle: null,
    body: null,
    details: { category: "Forms", url: "https://example.org/demo-leave-form" },
    linkedDocumentIds: [],
    tags: ["Forms"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 10,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(76),
    section: "logistics",
    slug: "demo-expense-claim-form",
    title: "Expense claim form",
    subtitle: null,
    body: null,
    details: { category: "Forms", url: "https://example.org/demo-expense-claim" },
    linkedDocumentIds: [],
    tags: ["Forms"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 11,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  // Every row in this folder is private, so board 11's in-card explanation of
  // the private treatment renders. No credential is stated anywhere in it: the
  // point of these rows is that the answer is withheld, which is exactly what
  // the section is allowed to hold.
  entry({
    id: id(63),
    section: "logistics",
    slug: "demo-after-hours-entry",
    title: "After-hours entry",
    subtitle: "Which door, and what to do when the card fails",
    body: null,
    details: { category: "Access" },
    linkedDocumentIds: [],
    tags: ["Access"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 12,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(64),
    section: "logistics",
    slug: "demo-locked-wards",
    title: "Locked wards",
    subtitle: "And who can let you through",
    body: null,
    details: { category: "Access" },
    linkedDocumentIds: [],
    tags: ["Access"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 13,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(77),
    section: "logistics",
    slug: "demo-logins-and-remote-access",
    title: "Logins, paging and remote access",
    subtitle: "Who to ask, and how long it takes",
    body: "Placeholder note shown only in demo mode. No login is recorded here.",
    details: { category: "Access" },
    linkedDocumentIds: [],
    tags: ["Access"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 14,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(60),
    section: "logistics",
    slug: "demo-on-call-room",
    title: "On-call room",
    subtitle: null,
    body: null,
    details: { category: "Facilities", location: "Level 2, past the lifts" },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 15,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(61),
    section: "logistics",
    slug: "demo-food-after-hours",
    title: "Food after hours",
    subtitle: null,
    body: null,
    details: { category: "Facilities", location: "Level 1 foyer", hours: "Vending only after 19:30" },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 16,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(62),
    section: "logistics",
    slug: "demo-security-escort",
    title: "Security escort",
    subtitle: null,
    body: null,
    details: { category: "Facilities", phone: demoNumber(3) },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 17,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // Ten more rows, weighted towards Leave.
  //
  // Leave is the folder this section was re-pointed at — the work admin a
  // doctor does for themselves rather than the site's logistics — and three
  // rows did not show that. Seven does: the reader can see that sick leave,
  // PDL, annual, parental, carer's, study and unpaid leave are seven
  // different processes with seven different people to tell, which is the
  // fact the folder exists to make findable at all.
  //
  // No new folder is invented. `ADMIN_CATEGORY_OPTIONS` in the editor is the
  // whole list, and a row that will not fit one of its six words is a change
  // to that list rather than a seventh word typed in here.
  entry({
    id: id(120),
    section: "logistics",
    slug: "demo-carers-leave",
    title: "Carer's leave",
    subtitle: "Who to tell, and what counts",
    body: null,
    details: { category: "Leave", url: "https://example.org/demo-carers-leave" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 18,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(121),
    section: "logistics",
    slug: "demo-study-and-exam-leave",
    title: "Study and exam leave",
    subtitle: "Separate from PDL, and applied for separately",
    body: null,
    details: { category: "Leave", url: "https://example.org/demo-study-leave" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 19,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(122),
    section: "logistics",
    slug: "demo-leave-without-pay",
    title: "Leave without pay",
    subtitle: "What it does to your increment and your accrual",
    body: null,
    details: { category: "Leave" },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 20,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
  entry({
    id: id(123),
    section: "logistics",
    slug: "demo-compassionate-leave",
    title: "Compassionate leave",
    subtitle: "Ring first, paperwork after",
    body: "Placeholder administrative note shown only in demo mode.",
    details: { category: "Leave", phone: demoNumber(80) },
    linkedDocumentIds: [],
    tags: ["Leave"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 21,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(124),
    section: "logistics",
    slug: "demo-safe-hours-and-night-rosters",
    title: "Safe hours and night rosters",
    subtitle: "The breaks the roster is meant to give you",
    body: null,
    details: { category: "Rosters", url: "https://example.org/demo-safe-hours" },
    linkedDocumentIds: [],
    tags: ["Roster"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 22,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(125),
    section: "logistics",
    slug: "demo-higher-duties",
    title: "Higher duties and acting up",
    subtitle: "What to claim when you cover a level above your own",
    body: null,
    details: { category: "Pay", hours: "Weekdays, business hours", phone: demoNumberAlt(6) },
    linkedDocumentIds: [],
    tags: ["Pay"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 23,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(126),
    section: "logistics",
    slug: "demo-relocation-allowance",
    title: "Relocation and accommodation allowance",
    subtitle: "For a term at another site",
    body: null,
    details: { category: "Pay", url: "https://example.org/demo-relocation" },
    linkedDocumentIds: [],
    tags: ["Pay"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 24,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(127),
    section: "logistics",
    slug: "demo-incident-and-hazard-form",
    title: "Incident and hazard report form",
    subtitle: "Same shift, not the next morning",
    body: null,
    details: { category: "Forms", url: "https://example.org/demo-incident-form" },
    linkedDocumentIds: [],
    tags: ["Forms"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 25,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(128),
    section: "logistics",
    slug: "demo-flexible-working-request-form",
    title: "Flexible working request form",
    subtitle: null,
    body: null,
    details: { category: "Forms", url: "https://example.org/demo-flexible-working" },
    linkedDocumentIds: [],
    tags: ["Forms"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 26,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(129),
    section: "logistics",
    slug: "demo-parking-permit",
    title: "Parking permit",
    subtitle: "And where to park before it comes through",
    body: null,
    // Private, like every other row in this folder. The Access folder is
    // whole-folder private by construction and a test asserts it, because a
    // single shared row in it would make the page's blanket statement false.
    details: { category: "Access" },
    linkedDocumentIds: [],
    tags: ["Access"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 27,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),

  // ---- Compliance: Admin rows whose point is that they expire ----
  //
  // Same stored section, told apart by `details.kind` — see
  // src/lib/on-call/compliance.ts. The page sorts on `consequence`, not on the
  // date, so the corpus carries every band: two that stop you working, two that
  // stop part of the work, three that get you chased, and one with no
  // consequence recorded at all, which is the band a reader most needs to see
  // rendered rather than guessed at.
  //
  // `expiresOn` is dated relative to today, like the teaching sessions above,
  // so the spread survives the corpus being read a year from now: one lapsed,
  // one within the month, and the rest out to a year.
  //
  // `category` is one word here too. It renders as a pill on the row rather
  // than as a heading — this page groups by band, not by category — but the
  // owner picks it from the same editor as the Admin folders, and two naming
  // conventions inside one editor is how the long ones creep back.
  //
  // **Nothing here is checked with an issuing body**, so no row states one is
  // held, current or in order. Each says what was recorded, who issues it, and
  // how the date came to be believed (`provenance`) — and leaves the judgement
  // to the reader.
  //
  // **Every row here is `isPersonal: true`, and that is not a demo detail.**
  // The 2026-09-04 owner decision that lets an anonymous caller read the
  // non-personal entries was about ward numbers and escalation ladders — the
  // things a covering doctor needs at 3am without an account. It was never
  // about a named doctor's registration, indemnity, credentialing, Working
  // with Children Check and police clearance, which is an identity dossier and
  // has no business on a page a visitor can open. Compliance rows are
  // therefore written private, and the corpus models what the app produces
  // rather than the defect it used to. Demo mode serves every row regardless
  // of the flag (the route never reaches the shared-read predicate), so the
  // page still fills for a visitor with no account.
  //
  // Seven rows carry a `requirementId`, linking them to their item on Admin's
  // statewide Requirements catalogue (`src/lib/admin/requirements.ts`), so the
  // demo Renewals checklist fills the way the Admin mock-up does (a passed
  // date, items to start renewing, recorded rows) rather than showing twenty
  // "Not recorded yet" slots. The fire and evacuation module matches no
  // catalogue item and shows on Renewals' Personal tab.
  //
  // Because the whole page is private by construction, the page states it once
  // in `ComplianceScopeNote` instead of hanging a "Private" pill off all eight
  // rows — see `on-call-compliance-section.tsx`. Unset the flag on any row
  // here and the page notices: the pills come back and the page-level sentence
  // goes away, because a blanket claim over a mixed page would be false.
  entry({
    id: id(80),
    section: "logistics",
    slug: "demo-medical-registration",
    title: "Medical registration",
    subtitle: "Renewal falls due once a year",
    body: "Placeholder entry shown only in demo mode. Nothing here has been checked with the issuing body.",
    details: {
      category: "Registration",
      kind: "compliance",
      requirementId: "medical-registration-renewal",
      consequence: "stops-work",
      expiresOn: demoDateKey(52),
      leadTimeDays: 60,
      issuingBody: "Ahpra",
      provenance: "confirmed",
      evidenceUrl: "https://example.org/demo-registration-receipt",
    },
    linkedDocumentIds: [],
    tags: ["Registration"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(81),
    section: "logistics",
    slug: "demo-medical-indemnity",
    title: "Medical indemnity cover",
    subtitle: "Policy runs a year at a time",
    body: null,
    details: {
      category: "Indemnity",
      kind: "compliance",
      requirementId: "professional-indemnity-insurance",
      consequence: "stops-work",
      expiresOn: demoDateKey(126),
      issuingBody: "Indemnity insurer",
      provenance: "read-from-certificate",
      evidenceUrl: "https://example.org/demo-indemnity-certificate",
    },
    linkedDocumentIds: [],
    tags: ["Indemnity"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 1,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(82),
    section: "logistics",
    slug: "demo-credentialing-scope-of-practice",
    title: "Credentialing and scope of practice",
    subtitle: "Reviewed by the demo credentialing committee",
    body: null,
    details: {
      category: "Credentialing",
      kind: "compliance",
      requirementId: "credentialing-and-scope",
      consequence: "stops-part",
      expiresOn: demoDateKey(240),
      leadTimeDays: 90,
      issuingBody: "Health Service credentialing committee",
      provenance: "typed",
    },
    linkedDocumentIds: [],
    tags: ["Credentialing"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 2,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(83),
    section: "logistics",
    slug: "demo-working-with-children-check",
    title: "Working with Children Check",
    subtitle: "Renewed every three years",
    body: null,
    details: {
      category: "Clearances",
      kind: "compliance",
      requirementId: "working-with-children-check",
      consequence: "stops-part",
      expiresOn: demoDateKey(310),
      leadTimeDays: 120,
      issuingBody: "Department of Communities (WA)",
      provenance: "read-from-certificate",
    },
    linkedDocumentIds: [],
    tags: ["Screening"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 3,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(84),
    section: "logistics",
    slug: "demo-basic-life-support-module",
    title: "Basic life support module",
    subtitle: "Online module and a practical session",
    // The one already past its recorded date, so the lapsed treatment appears
    // in a browser rather than only in a test.
    body: null,
    details: {
      category: "Training",
      kind: "compliance",
      requirementId: "resuscitation-competence",
      consequence: "chased",
      expiresOn: demoDateKey(-12),
      leadTimeDays: 14,
      issuingBody: "Health Service",
      provenance: "typed",
    },
    linkedDocumentIds: [],
    tags: ["Training"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 4,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(85),
    section: "logistics",
    slug: "demo-fire-and-evacuation-module",
    title: "Fire and evacuation module",
    subtitle: "Half an hour, online",
    body: null,
    details: {
      category: "Training",
      kind: "compliance",
      consequence: "chased",
      expiresOn: demoDateKey(21),
      leadTimeDays: 7,
      issuingBody: "Health Service",
      provenance: "typed",
    },
    linkedDocumentIds: [],
    tags: ["Training"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 5,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(86),
    section: "logistics",
    slug: "demo-cpd-annual-return",
    title: "CPD annual return",
    subtitle: "Through the college CPD home",
    body: null,
    details: {
      category: "CPD",
      kind: "compliance",
      requirementId: "cpd-home-and-hours",
      consequence: "chased",
      expiresOn: demoDateKey(95),
      leadTimeDays: 30,
      issuingBody: "RANZCP",
      provenance: "typed",
    },
    linkedDocumentIds: [],
    tags: ["CPD"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 6,
    lastVerifiedAt: VERIFIED_RECENTLY,
  }),
  entry({
    id: id(87),
    section: "logistics",
    slug: "demo-national-police-clearance",
    title: "National police clearance",
    subtitle: "Months, not weeks, to come back",
    // No `consequence`: the one row that lands in the page's "no consequence
    // recorded" band. Unknown is not the same as harmless, and the band exists
    // so a reader can see which rows nobody has thought through yet.
    body: null,
    details: {
      category: "Clearances",
      kind: "compliance",
      requirementId: "criminal-record-screening",
      expiresOn: demoDateKey(400),
      leadTimeDays: 150,
      issuingBody: "Screening provider",
      provenance: "typed",
    },
    linkedDocumentIds: [],
    tags: ["Screening"],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 7,
    lastVerifiedAt: NEVER_VERIFIED,
  }),
];
