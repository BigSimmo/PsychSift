import type { ServiceDetail, ServiceEntry, ServiceSummary } from "@/lib/on-call/service-model";

/**
 * The synthetic hospital handbook demo mode shows, shared by Manage service
 * (`ServicePage`) and `useHospitalHandbook`, so demo mode and the browser specs
 * have content on every On Call page.
 *
 * Everything here is made up (plan Global Constraint 9): the service, the site,
 * every title and every number. Hospital lines use ACMA’s reserved fictitious range `08 5550 xxxx`
 * (https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works). The
 * emergency row uses the made-up short code `55` — never 000, which is the
 * national emergency number, not a ward code. Each body says "Synthetic example
 * only". The one source link points at a reserved example domain, so no real
 * publisher appears to endorse a made-up number.
 */

export const DEMO_SERVICE_ID = "60000000-0000-4000-8000-000000000001";
export const DEMO_SITE_ID = "60000000-0000-4000-8000-000000000002";
const DEMO_AUTHOR_ID = "60000000-0000-4000-8000-000000000003";
const DEMO_REVIEWER_ID = "60000000-0000-4000-8000-000000000004";

function demoEntry(
  id: string,
  content: ServiceEntry["content"],
  overrides: Partial<Omit<ServiceEntry, "id" | "content">> = {},
): ServiceEntry {
  return {
    id,
    revision: 1,
    publishedRevision: 1,
    content,
    publishedContent: content,
    status: "published",
    authorId: DEMO_AUTHOR_ID,
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: "",
    updatedAt: "2026-09-20T04:00:00.000Z",
    publishedAt: "2026-09-20T04:00:00.000Z",
    lastConfirmedAt: null,
    ...overrides,
  };
}

function hospitalRow(
  id: string,
  section: ServiceEntry["content"]["section"],
  title: string,
  phone: string,
  body = "Synthetic example only.",
  orientationPhase: ServiceEntry["content"]["orientationPhase"] = "first_shift",
): ServiceEntry {
  return demoEntry(id, {
    siteId: DEMO_SITE_ID,
    section,
    kind: "operational",
    title,
    body,
    phone,
    sources: [],
    orientationPhase,
  });
}

export const demoServiceDetail: ServiceDetail = {
  service: { id: DEMO_SERVICE_ID, name: "Synthetic Metro Psychiatry Service" },
  membership: { role: "admin", clinicalReviewer: true },
  // After-hours times so the local demo shows Right now's period and track.
  sites: [{ id: DEMO_SITE_ID, name: "Demonstration Hospital", afterHoursStart: "17:00", afterHoursEnd: "08:00" }],
  entries: [
    demoEntry(
      "61000000-0000-4000-8000-000000000019",
      {
        siteId: DEMO_SITE_ID,
        section: "cover",
        kind: "clinical",
        title: "Synthetic role cover",
        body: "Synthetic example only.",
        phone: "5550 0042",
        sources: [{ label: "Synthetic policy", url: "https://example.org/policy" }],
        orientationPhase: "first_shift",
        cover: {
          staffName: "Dr Alex Example",
          grade: "registrar",
          team: "Medicine",
          window: { start: "00:00", end: "23:59" },
        },
      },
      { reviewedBy: DEMO_REVIEWER_ID, reviewedAt: "2026-09-20T04:00:00.000Z" },
    ),
    // Unnamed psychiatry cover, so "Also on tonight" has rows after hours, as the mock-up draws it.
    demoEntry(
      "61000000-0000-4000-8000-000000000024",
      {
        siteId: DEMO_SITE_ID,
        section: "cover",
        kind: "clinical",
        title: "Psychiatry: Consultant on call",
        body: "Synthetic example only.",
        phone: "5550 0024",
        sources: [{ label: "Synthetic roster", url: "https://example.org/roster" }],
        orientationPhase: "first_shift",
        cover: { grade: "consultant", team: "Psychiatry", window: { start: "17:00", end: "08:00" } },
      },
      { reviewedBy: DEMO_REVIEWER_ID, reviewedAt: "2026-09-20T04:00:00.000Z" },
    ),
    demoEntry(
      "61000000-0000-4000-8000-000000000025",
      {
        siteId: DEMO_SITE_ID,
        section: "cover",
        kind: "clinical",
        title: "Psychiatry: Registrar on call",
        body: "Synthetic example only.",
        phone: "5550 0042",
        sources: [{ label: "Synthetic roster", url: "https://example.org/roster" }],
        orientationPhase: "first_shift",
        cover: { grade: "registrar", team: "Psychiatry", window: { start: "17:00", end: "08:00" } },
      },
      { reviewedBy: DEMO_REVIEWER_ID, reviewedAt: "2026-09-20T04:00:00.000Z" },
    ),
    demoEntry(
      "61000000-0000-4000-8000-000000000020",
      {
        siteId: DEMO_SITE_ID,
        section: "playbook",
        kind: "clinical",
        title: "Synthetic contact ladder",
        body: "Synthetic example only.",
        phone: "",
        sources: [{ label: "Synthetic policy", url: "https://example.org/policy" }],
        orientationPhase: "first_shift",
        steps: [
          { order: 1, whoToCall: "Synthetic first role", when: "First contact", phone: "5550 0042", waitMinutes: 10 },
          {
            order: 2,
            whoToCall: "Synthetic second role",
            when: "When the first role cannot be reached",
            phone: "5550 0043",
          },
        ],
      },
      { reviewedBy: DEMO_REVIEWER_ID, reviewedAt: "2026-09-20T04:00:00.000Z" },
    ),
    demoEntry("61000000-0000-4000-8000-000000000001", {
      siteId: DEMO_SITE_ID,
      section: "contacts",
      kind: "operational",
      title: "Example after-hours coordination extension",
      body: "Synthetic example only. This is not a real service or contact.",
      phone: "0001",
      sources: [],
      orientationPhase: "first_shift",
    }),
    demoEntry("61000000-0000-4000-8000-000000000002", {
      siteId: DEMO_SITE_ID,
      section: "referrals",
      kind: "operational",
      title: "Example internal referral route",
      body: "Synthetic demonstration of where a locally maintained referral route would appear.",
      phone: "",
      sources: [],
      orientationPhase: "first_shift",
    }),
    demoEntry("61000000-0000-4000-8000-000000000003", {
      siteId: DEMO_SITE_ID,
      section: "orientation",
      kind: "operational",
      title: "Collect the synthetic on-call handset",
      body: "Demonstration item only.",
      phone: "",
      sources: [],
      orientationPhase: "before_start",
    }),
    demoEntry("61000000-0000-4000-8000-000000000004", {
      siteId: DEMO_SITE_ID,
      section: "orientation",
      kind: "operational",
      title: "Locate the synthetic escalation list",
      body: "Demonstration item only.",
      phone: "",
      sources: [],
      orientationPhase: "first_shift",
    }),
    demoEntry("61000000-0000-4000-8000-000000000005", {
      siteId: DEMO_SITE_ID,
      section: "orientation",
      kind: "operational",
      title: "Return the synthetic handset",
      body: "Demonstration item only.",
      phone: "",
      sources: [],
      orientationPhase: "leaving",
    }),
    demoEntry(
      "61000000-0000-4000-8000-000000000006",
      {
        siteId: null,
        section: "documentation",
        kind: "clinical",
        title: "Example reviewed clinical summary",
        body: "Synthetic example showing independent review metadata; it contains no clinical advice.",
        phone: "",
        sources: [
          {
            label: "WA Health policy frameworks",
            url: "https://www.health.wa.gov.au/About-us/Policy-frameworks",
          },
        ],
        orientationPhase: "first_shift",
      },
      {
        reviewedBy: DEMO_REVIEWER_ID,
        reviewedAt: "2026-09-21T04:00:00.000Z",
      },
    ),
    // Rows for the rebuilt shift pages (kit 1.5). The emergency row is saved as
    // clinical with a site, so it is the one row Now pins (review F2).
    demoEntry(
      "61000000-0000-4000-8000-000000000007",
      {
        siteId: DEMO_SITE_ID,
        section: "contacts",
        kind: "clinical",
        title: "Emergency: Synthetic emergency line",
        body: "Synthetic example only. Dial from a hospital phone.\nFrom a mobile: 5550 0000, 55",
        phone: "55",
        sources: [{ label: "Synthetic hospital procedure", url: "https://example.org/synthetic-emergency-procedure" }],
        orientationPhase: "first_shift",
      },
      { reviewedBy: DEMO_REVIEWER_ID, reviewedAt: "2026-09-21T04:00:00.000Z" },
    ),
    hospitalRow("61000000-0000-4000-8000-000000000008", "contacts", "Switchboard", "5550 0000"),
    hospitalRow("61000000-0000-4000-8000-000000000009", "contacts", "Medicine: Registrar on call", "5550 0000, 4455"),
    hospitalRow("61000000-0000-4000-8000-000000000010", "contacts", "ICU: Registrar", "4456"),
    // The psychiatry nurse in charge, beside the psychiatry cover rows above.
    hospitalRow("61000000-0000-4000-8000-000000000023", "contacts", "Psychiatry: Nurse in charge", "4000"),
    hospitalRow("61000000-0000-4000-8000-000000000011", "contacts", "Ward: Synthetic ward 4B", "5550 0012"),
    hospitalRow(
      "61000000-0000-4000-8000-000000000012",
      "resources",
      "Ward: Synthetic ward 4B",
      "",
      "Synthetic example only. Level 4, west wing.\nAlso known as: 4 West",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000013",
      "resources",
      "Access: Car park after hours",
      "",
      "Synthetic example only. Use the staff entrance after 21:00.",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000014",
      "resources",
      "Equipment: Bladder scanner",
      "",
      "Synthetic example only. Kept in the synthetic ward 4B store room.",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000015",
      "resources",
      "Downtime: If the electronic record is down",
      "",
      "Synthetic example only. Use the paper forms in the ward office and ring switchboard to log the outage.",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000016",
      "orientation",
      "Check the synthetic handover list",
      "",
      "Synthetic example only.",
      "first_shift",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000017",
      "orientation",
      "Hand the synthetic pager to the next doctor",
      "",
      "Synthetic example only.",
      "ongoing",
    ),
    hospitalRow(
      "61000000-0000-4000-8000-000000000018",
      "orientation",
      "Write up the synthetic shift log",
      "",
      "Synthetic example only.",
      "ongoing",
    ),
  ],
  members: [
    { id: DEMO_AUTHOR_ID, role: "admin", clinicalReviewer: false, joinedAt: "2026-08-01T00:00:00.000Z" },
    { id: DEMO_REVIEWER_ID, role: "editor", clinicalReviewer: true, joinedAt: "2026-08-02T00:00:00.000Z" },
  ],
  invitations: [],
  reports: [],
  orientation: [],
};

export const demoServiceSummary: ServiceSummary = {
  id: DEMO_SERVICE_ID,
  name: demoServiceDetail.service.name,
  role: "admin",
  clinicalReviewer: true,
  sites: demoServiceDetail.sites,
};

/**
 * The signed-out sample hospital: the same synthetic service with its reserved
 * `5550` numbers swapped for the `0000` placeholders, which are shown as text
 * and never linked to a dialler. Built in memory; nothing is stored.
 */
export const sampleServiceDetail: ServiceDetail = JSON.parse(
  JSON.stringify(demoServiceDetail).replace(/\b5550 (\d{4})\b/g, "0000 $1"),
) as ServiceDetail;
