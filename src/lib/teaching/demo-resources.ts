import { addDays } from "@/lib/calendar/calendar-event";
import { PublicApiError } from "@/lib/http";
import {
  DEMO_TEACHING_SERVICE_ID,
  demoSeriesId,
  demoTeachingSessionDetail,
  demoTeachingSessions,
  parseDemoOccurrenceId,
} from "@/lib/teaching/demo-programme";
import {
  resourceRowSchema,
  type CollectionRead,
  type ResourceRow,
  type ResourcesForSession,
  type ResourcesForWeek,
  type TeachingResourcesQuery,
} from "@/lib/teaching/model";
import { perthToday } from "@/lib/teaching/time";

/**
 * Resources for the demo (master plan R8), shaped like the approved v5 mock-up: four materials for this
 * week, four recordings, six collections and two saved items. Every title starts "Demo", every link is on
 * example.org, and every count is the length of a real list here, so a collection page shows as many items
 * as its tile says.
 *
 * This week's four materials each belong to one of the demo service's own sessions: matched by name when
 * the made-up programme has that session (a case presentation, a journal club, a psychotherapy seminar, a
 * workshop), otherwise the next session not yet used, so "For this week" always has four. Once that week's
 * case conference has ended it gains a recording, marked catch-up because the demo viewer has no
 * attendance for it. The other three recordings sit a week or two back, relative to today.
 *
 * The library items point at the synthetic demo library's own documents, which exist in demo mode, so they
 * open inside the app. Nothing here records a page count, a recording's length or how much was watched,
 * because the app stores none of those.
 */

const EXAM_PREP_ID = "00000000-0000-4000-b900-000000000001";
const CASE_SERIES_ID = "00000000-0000-4000-b900-000000000003";
const JOURNAL_CLUB_ID = "00000000-0000-4000-b900-000000000004";
const SUPERVISION_ID = "00000000-0000-4000-b900-000000000005";
const HANDOUTS_ID = "00000000-0000-4000-b900-000000000006";
const WORKSHOPS_ID = "00000000-0000-4000-b900-000000000007";
const WRITTEN_SECTION_ID = "00000000-0000-4000-b901-000000000001";
const CLINICAL_SECTION_ID = "00000000-0000-4000-b901-000000000002";
/** Synthetic demo library documents (`src/lib/demo-data.ts`): the lithium and risk triage protocols. */
const DEMO_LIBRARY_LITHIUM = "11111111-1111-4111-8111-111111111111";
const DEMO_LIBRARY_RISK = "33333333-3333-4333-8333-333333333333";
const CASE_CONFERENCE_KEY = 3;
const STATIC_ADDED_AT = "2026-08-03T01:00:00.000Z";

/** In the mock-up's order. The database orders by name; the demo keeps the order the design shows. */
const COLLECTIONS = [
  { collectionId: CASE_SERIES_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Case series" },
  { collectionId: JOURNAL_CLUB_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Journal club" },
  { collectionId: EXAM_PREP_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Exam prep" },
  { collectionId: SUPERVISION_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Supervision" },
  { collectionId: HANDOUTS_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Handouts" },
  { collectionId: WORKSHOPS_ID, serviceId: DEMO_TEACHING_SERVICE_ID, name: "Workshops" },
] as const;

const SECTIONS: Record<string, CollectionRead["sections"]> = {
  [EXAM_PREP_ID]: [
    { sectionId: WRITTEN_SECTION_ID, name: "Written exam", sortOrder: 0 },
    { sectionId: CLINICAL_SECTION_ID, name: "Clinical exam", sortOrder: 1 },
  ],
};

function resourceId(index: number, date?: string): string {
  const tail = date ? `${date.replace(/-/g, "")}0000` : "000000000000";
  return `00000000-0000-4000-8${String(index).padStart(3, "0")}-${tail}`;
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type Link = { url: string } | { libraryDocumentId: string };

function collectionItem(
  index: number,
  collectionId: string,
  title: string,
  kind: ResourceRow["kind"],
  link: Link,
  options: { sectionId?: string; saved?: boolean; addedAt?: string } = {},
): ResourceRow {
  return {
    resourceId: resourceId(index),
    serviceId: DEMO_TEACHING_SERVICE_ID,
    title,
    kind,
    url: "url" in link ? link.url : null,
    libraryDocumentId: "libraryDocumentId" in link ? link.libraryDocumentId : null,
    collectionId,
    sectionId: options.sectionId ?? null,
    occurrenceId: null,
    seriesId: null,
    addedAt: options.addedAt ?? STATIC_ADDED_AT,
    saved: options.saved ?? false,
  };
}

const pdf = (title: string) => ({ url: `https://example.org/${slug(title)}.pdf` });
const page = (title: string) => ({ url: `https://example.org/${slug(title)}` });

/** A numbered run of plain made-up items, so a large collection really holds as many as its tile says. */
function numbered(first: number, collectionId: string, label: string, count: number, kind: ResourceRow["kind"]) {
  return Array.from({ length: count }, (_, at) => {
    const title = `Demo ${label} ${at + 1}`;
    return collectionItem(first + at, collectionId, title, kind, kind === "link" ? page(title) : pdf(title));
  });
}

/** Collections, nine of them Exam prep; the two saved items carry dates relative to today. */
function collectionItems(today: string): ResourceRow[] {
  const savedAt = (daysBack: number) => `${addDays(today, -daysBack)}T02:00:00.000Z`;
  return [
    collectionItem(1, EXAM_PREP_ID, "Demo MCQ technique", "link", page("Demo MCQ technique"), {
      sectionId: WRITTEN_SECTION_ID,
    }),
    collectionItem(2, EXAM_PREP_ID, "Demo past paper walkthrough", "link", page("Demo past paper walkthrough"), {
      sectionId: WRITTEN_SECTION_ID,
    }),
    collectionItem(3, EXAM_PREP_ID, "Demo exam syllabus", "link", page("Demo exam syllabus"), {
      sectionId: WRITTEN_SECTION_ID,
    }),
    collectionItem(
      4,
      EXAM_PREP_ID,
      "Demo guideline",
      "library",
      { libraryDocumentId: DEMO_LIBRARY_LITHIUM },
      {
        sectionId: WRITTEN_SECTION_ID,
      },
    ),
    collectionItem(5, EXAM_PREP_ID, "Demo critical appraisal practice", "reading", pdf("Demo critical appraisal"), {
      sectionId: WRITTEN_SECTION_ID,
    }),
    collectionItem(6, EXAM_PREP_ID, "Demo essay planning guide", "reading", pdf("Demo essay planning guide"), {
      sectionId: WRITTEN_SECTION_ID,
    }),
    collectionItem(7, EXAM_PREP_ID, "Demo observed interview practice", "link", page("Demo observed interview"), {
      sectionId: CLINICAL_SECTION_ID,
    }),
    collectionItem(8, EXAM_PREP_ID, "Demo formulation template", "reading", pdf("Demo formulation template"), {
      sectionId: CLINICAL_SECTION_ID,
    }),
    collectionItem(9, EXAM_PREP_ID, "Demo clinical exam stations", "reading", pdf("Demo clinical exam stations"), {
      sectionId: CLINICAL_SECTION_ID,
    }),
    ...numbered(20, CASE_SERIES_ID, "case series", 14, "reading"),
    ...numbered(40, JOURNAL_CLUB_ID, "journal club paper", 22, "link"),
    collectionItem(70, SUPERVISION_ID, "Demo formulation seminar slides", "link", pdf("Demo formulation seminar"), {
      saved: true,
      addedAt: savedAt(8),
    }),
    collectionItem(71, SUPERVISION_ID, "Demo supervision agreement", "reading", pdf("Demo supervision agreement")),
    collectionItem(72, SUPERVISION_ID, "Demo reflective practice log", "reading", pdf("Demo reflective practice log")),
    collectionItem(73, SUPERVISION_ID, "Demo learning plan", "reading", pdf("Demo learning plan")),
    collectionItem(74, SUPERVISION_ID, "Demo supervision record", "reading", pdf("Demo supervision record")),
    collectionItem(75, SUPERVISION_ID, "Demo feedback form", "reading", pdf("Demo feedback form")),
    collectionItem(80, HANDOUTS_ID, "Demo exam tips handout", "reading", pdf("Demo exam tips handout"), {
      saved: true,
      addedAt: savedAt(22),
    }),
    collectionItem(81, HANDOUTS_ID, "Demo risk assessment handout", "library", {
      libraryDocumentId: DEMO_LIBRARY_RISK,
    }),
    ...numbered(82, HANDOUTS_ID, "handout", 29, "reading"),
    collectionItem(120, WORKSHOPS_ID, "Demo interview skills workshop", "reading", pdf("Demo interview skills")),
    collectionItem(121, WORKSHOPS_ID, "Demo risk assessment workshop", "reading", pdf("Demo risk workshop")),
    collectionItem(122, WORKSHOPS_ID, "Demo teaching skills workshop", "reading", pdf("Demo teaching skills")),
    collectionItem(123, WORKSHOPS_ID, "Demo mental state examination workshop", "reading", pdf("Demo MSE workshop")),
    collectionItem(124, WORKSHOPS_ID, "Demo simulation workshop notes", "reading", pdf("Demo simulation notes")),
  ];
}

/** Recordings of earlier weeks' sessions, a week or two back from today. */
function earlierRecordings(today: string): ResourceRow[] {
  const recording = (index: number, title: string, daysBack: number): ResourceRow => ({
    ...collectionItem(index, "", title, "recording", page(title), {
      addedAt: `${addDays(today, -daysBack)}T10:00:00.000Z`,
    }),
    collectionId: null,
  });
  return [
    recording(130, "Demo research meeting", 5),
    recording(131, "Demo registrar teaching", 7),
    recording(132, "Demo grand rounds", 14),
  ];
}

type WeekItem = ResourceRow & { catchUp: boolean; firstStart: string };

/** This week's four materials, each matched to a session by name when the programme has one. */
const WEEK_MATERIALS: readonly { title: string; kind: ResourceRow["kind"]; match: RegExp; pdf: boolean }[] = [
  { title: "Demo case presentation handout", kind: "reading", match: /case presentation/i, pdf: true },
  { title: "Demo journal club slides", kind: "link", match: /journal club/i, pdf: false },
  { title: "Demo psychotherapy reading", kind: "reading", match: /psychotherapy/i, pdf: true },
  { title: "Demo workshop checklist", kind: "reading", match: /workshop|simulation/i, pdf: true },
];

/** The session resources of one week, [from, from + 6], as the database would list them. */
function weekItems(from: string, now: Date): WeekItem[] {
  const sessions = demoTeachingSessions({ from, to: addDays(from, 6) }, now).filter(
    (session) => session.serviceId === DEMO_TEACHING_SERVICE_ID && session.status !== "cancelled",
  );
  const items: WeekItem[] = [];
  const base = {
    serviceId: DEMO_TEACHING_SERVICE_ID,
    libraryDocumentId: null,
    collectionId: null,
    sectionId: null,
    seriesId: null,
    saved: false,
  };
  const used = new Set<string>();
  const upcoming = sessions.filter((session) => Date.parse(session.endsAt) > now.getTime());
  WEEK_MATERIALS.forEach((material, at) => {
    const session =
      sessions.find((candidate) => !used.has(candidate.occurrenceId) && material.match.test(candidate.title)) ??
      upcoming.find((candidate) => !used.has(candidate.occurrenceId)) ??
      sessions.find((candidate) => !used.has(candidate.occurrenceId));
    if (!session) return;
    used.add(session.occurrenceId);
    const parsed = parseDemoOccurrenceId(session.occurrenceId);
    items.push({
      ...base,
      resourceId: resourceId(140 + at, parsed?.date),
      title: material.title,
      kind: material.kind,
      url: material.pdf ? pdf(material.title).url : page(material.title).url,
      occurrenceId: session.occurrenceId,
      addedAt: new Date(Date.parse(session.startsAt) - 86_400_000).toISOString(),
      catchUp: false,
      firstStart: session.startsAt,
    });
  });
  // The demo records no attendance, so the case conference's recording is catch-up once that session ends.
  for (const session of sessions) {
    const parsed = parseDemoOccurrenceId(session.occurrenceId);
    if (!parsed || parsed.key !== CASE_CONFERENCE_KEY || Date.parse(session.endsAt) > now.getTime()) continue;
    items.push({
      ...base,
      resourceId: resourceId(9, parsed.date),
      title: session.title,
      kind: "recording",
      url: page(`${session.title} recording`).url,
      occurrenceId: session.occurrenceId,
      addedAt: session.endsAt,
      catchUp: true,
      firstStart: session.startsAt,
    });
  }
  return items.sort((a, b) => a.firstStart.localeCompare(b.firstStart) || a.resourceId.localeCompare(b.resourceId));
}

/** The resource as the database returns it: parsing drops the demo's own bookkeeping keys. */
function row(item: WeekItem): ResourceRow {
  return resourceRowSchema.parse(item);
}

function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** Everything the demo viewer can see today: the collections, earlier recordings and this Perth week's materials. */
function library(now: Date): ResourceRow[] {
  const today = perthToday(now);
  return [...collectionItems(today), ...earlierRecordings(today), ...weekItems(mondayOf(today), now).map(row)];
}

function byTitle(a: ResourceRow, b: ResourceRow): number {
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.resourceId.localeCompare(b.resourceId);
}

function newestFirst(a: ResourceRow, b: ResourceRow): number {
  return b.addedAt.localeCompare(a.addedAt) || a.resourceId.localeCompare(b.resourceId);
}

function notInDemo(): PublicApiError {
  return new PublicApiError("This isn't available in the demo.", 404, { code: "teaching_not_found" });
}

function forSession(occurrenceId: string, now: Date): ResourcesForSession {
  const parsed = parseDemoOccurrenceId(occurrenceId);
  if (!parsed || !demoTeachingSessionDetail(occurrenceId, now)) throw notInDemo();
  const series = demoSeriesId(parsed.key);
  const items = weekItems(mondayOf(parsed.date), now)
    .filter((item) => item.occurrenceId === occurrenceId || (item.occurrenceId === null && item.seriesId === series))
    .map(row)
    .sort((a, b) => a.kind.localeCompare(b.kind) || byTitle(a, b));
  return { items };
}

function forWeek(weekStart: string, now: Date): ResourcesForWeek {
  const all = library(now);
  return {
    forThisWeek: weekItems(weekStart, now).map((item) => ({ ...row(item), catchUp: item.catchUp })),
    collections: COLLECTIONS.map((collection) => ({
      ...collection,
      count: all.filter((item) => item.collectionId === collection.collectionId).length,
    })),
    recordingsCount: all.filter((item) => item.kind === "recording").length,
    savedCount: all.filter((item) => item.saved).length,
  };
}

function readCollection(query: { collectionId?: string; builtIn?: string }, now: Date): CollectionRead {
  const all = library(now);
  if (query.builtIn === "recordings")
    return { collection: null, sections: [], items: all.filter((item) => item.kind === "recording").sort(newestFirst) };
  if (query.builtIn === "saved")
    return { collection: null, sections: [], items: all.filter((item) => item.saved).sort(newestFirst) };
  const collection = COLLECTIONS.find((candidate) => candidate.collectionId === query.collectionId);
  if (!collection) throw notInDemo();
  return {
    collection: { ...collection },
    sections: SECTIONS[collection.collectionId] ?? [],
    items: all.filter((item) => item.collectionId === collection.collectionId).sort(byTitle),
  };
}

/** `GET /api/teaching/resources` in demo mode: the same shapes the database returns, from made-up data. */
export function demoTeachingResources(
  query: TeachingResourcesQuery,
  now: Date = new Date(),
): ResourcesForSession | ResourcesForWeek | CollectionRead {
  if (query.action === "collection.read") return readCollection(query, now);
  if (query.occurrenceId) return forSession(query.occurrenceId, now);
  if (query.weekStart) return forWeek(query.weekStart, now);
  throw notInDemo();
}
