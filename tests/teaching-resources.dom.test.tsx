/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

import {
  filterResources,
  isCollectionParam,
  isHttpsLink,
  resourceHref,
  resourceSections,
} from "@/components/teaching/resources-model";
import { TeachingCollection } from "@/components/teaching/teaching-collection";
import { AddResourceSheet, SessionMaterials } from "@/components/teaching/teaching-resource-list";
import { TeachingResources } from "@/components/teaching/teaching-resources";
import type { ResourceRow } from "@/lib/teaching/model";

import {
  NB,
  NOW,
  OCC,
  TEAM_A,
  byId,
  detail,
  fetchCalls,
  json,
  serveFetch,
  session,
  teamA,
  teamB,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

// `useTeachingTestClock` only registers Vitest's beforeEach/afterEach; its name trips the hooks heuristic.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

const EXAM = "55555555-5555-4555-8555-555555555555";
const WRITTEN = "66666666-6666-4666-8666-666666666666";
const DOC = "77777777-7777-4777-8777-777777777777";
const WEEK_URL = "/api/teaching?view=week&from=2026-09-28&to=2026-10-04";
const WEEK_RESOURCES_URL = "/api/teaching/resources?action=resources.read&weekStart=2026-09-28";
const COLLECTION_URL = `/api/teaching/resources?action=collection.read&collectionId=${EXAM}`;
const RECORDINGS_URL = "/api/teaching/resources?action=collection.read&builtIn=recordings";
const SAVED_URL = "/api/teaching/resources?action=collection.read&builtIn=saved";
const builtIn = (items: ResourceRow[]) => json(200, { collection: null, sections: [], items });

function item(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    resourceId: "88888888-8888-4888-8888-888888888888",
    serviceId: TEAM_A,
    title: "MCQ practice paper",
    kind: "reading",
    url: "https://example.org/mcq",
    libraryDocumentId: null,
    collectionId: EXAM,
    sectionId: WRITTEN,
    occurrenceId: null,
    seriesId: null,
    addedAt: "2026-09-01T00:00:00.000Z",
    saved: false,
    ...overrides,
  };
}
const recording = item({
  resourceId: "99999999-9999-4999-8999-999999999999",
  title: "Grand round recording",
  kind: "recording",
  url: "https://example.org/rec",
  sectionId: null,
});

describe("resources-model", () => {
  it("filters by type and by the words typed, groups by section, and links a library document inside the app", () => {
    expect(filterResources([item(), recording], "recordings", "").map((r) => r.title)).toEqual([
      "Grand round recording",
    ]);
    expect(filterResources([item(), recording], "all", "  mcq ").map((r) => r.title)).toEqual(["MCQ practice paper"]);
    expect(
      resourceSections([{ sectionId: WRITTEN, name: "Written exam", sortOrder: 0 }], [item(), recording]).map((s) => [
        s.label,
        s.items.length,
      ]),
    ).toEqual([
      ["Written exam", 1],
      ["Other", 1],
    ]);
    expect(resourceHref(item({ kind: "library", url: null, libraryDocumentId: DOC }))).toBe(`/documents/${DOC}`);
    expect(isCollectionParam("saved")).toBe(true);
    expect(isCollectionParam("../x")).toBe(false);
  });

  it("opens only https links, as the server stores them", () => {
    expect(isHttpsLink("https://example.org/a")).toBe(true);
    expect(isHttpsLink("http://example.org/a")).toBe(false);
    expect(isHttpsLink("https://user@example.org/a")).toBe(false);
    expect(resourceHref(item({ url: "javascript:alert(1)" }))).toBeNull();
  });
});

describe("Resources", () => {
  it("shows this week's materials, recordings, collections, saved, and the way to CPD's learning directory", async () => {
    const slides = item({
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Registrar teaching slides",
      kind: "slides",
      url: "https://example.org/slides.pdf",
      collectionId: null,
      sectionId: null,
      occurrenceId: OCC,
    });
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, {
          forThisWeek: [
            { ...recording, catchUp: true },
            { ...slides, catchUp: false },
          ],
          collections: [{ collectionId: EXAM, serviceId: TEAM_A, name: "Exam prep", count: 12 }],
          recordingsCount: 3,
          savedCount: 1,
        });
      if (url === WEEK_URL) return json(200, week());
      if (url === RECORDINGS_URL) return builtIn([recording]);
      if (url === SAVED_URL) return builtIn([item({ saved: true })]);
      return null;
    });
    render(<TeachingResources demoMode={false} />);
    const thisWeek = await waitFor(() => byId("teaching-resources-week"));
    // This week's recording is listed once, under Recordings; a .pdf link reads "PDF", with its session's day.
    expect(within(thisWeek).queryByText("Grand round recording")).toBeNull();
    await waitFor(() => expect(within(thisWeek).getByText(/^PDF · /)).toBeInTheDocument());
    expect(within(thisWeek).getByRole("link", { name: /Registrar teaching slides/ })).toHaveAttribute(
      "href",
      "https://example.org/slides.pdf",
    );
    // Save stays on this week's rows: an item in no collection could not be saved anywhere else.
    expect(within(thisWeek).getAllByRole("button", { name: /^Save / }).length).toBeGreaterThan(0);
    expect(screen.getByText("For this week · 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Exam prep/ })).toHaveAttribute("href", `/teaching/resources/${EXAM}`);
    expect(screen.getByRole("link", { name: /^Exam prep/ }).textContent).toContain(`12${NB}items`);
    expect(screen.getByText("Recordings · 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/teaching/resources/recordings");
    const recordings = await waitFor(() => byId("teaching-resources-recordings"));
    expect(within(recordings).getByText(`Added Tue 1 Sep · no check-in recorded`)).toBeInTheDocument();
    const saved = await waitFor(() => byId("teaching-resources-saved"));
    expect(within(saved).getByRole("link", { name: /MCQ practice paper/ })).toHaveAttribute(
      "href",
      "https://example.org/mcq",
    );
    expect(screen.getByRole("link", { name: /^My exam prep/ })).toHaveAttribute("href", "/teaching/exam-prep");
    expect(screen.getByRole("link", { name: /WA courses and modules are in CPD/ })).toHaveAttribute(
      "href",
      "/cme/learning",
    );
    expect(screen.queryByRole("button", { name: "New collection" })).toBeNull(); // a doctor, not an organiser
  });

  it("says recordings did not load rather than showing none", async () => {
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, { forThisWeek: [], collections: [], recordingsCount: 2, savedCount: 0 });
      if (url === WEEK_URL) return json(200, week());
      if (url === RECORDINGS_URL) return json(500, { error: "nope" });
      if (url === SAVED_URL) return builtIn([]);
      return null;
    });
    render(<TeachingResources demoMode={false} />);
    expect(await screen.findByText("Recordings did not load. Open All to try again.")).toBeInTheDocument();
  });

  it("renders the demo's made-up resources in demo mode, offers New collection, and saves nothing", async () => {
    const fetchMock = serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, {
          forThisWeek: [{ ...item({ collectionId: null, sectionId: null }), catchUp: false }],
          collections: [{ collectionId: EXAM, serviceId: TEAM_A, name: "Exam prep", count: 1 }],
          recordingsCount: 1,
          savedCount: 0,
        });
      if (url === RECORDINGS_URL) return builtIn([recording]);
      if (url === SAVED_URL) return builtIn([]);
      return null;
    });
    render(<TeachingResources demoMode />);
    expect(await screen.findByText("MCQ practice paper")).toBeInTheDocument();
    expect(fetchCalls(fetchMock, "/api/teaching?view=week")).toBe(0); // the demo week is made on the device
    expect(screen.queryByTestId("teaching-catch-up")).toBeNull(); // the sample marks catch-up in Recordings
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Reading list" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByText("The sample doesn’t save changes.")).toBeInTheDocument();
    expect(fetchCalls(fetchMock, "/api/teaching/resources/services")).toBe(0);
  });

  it("offers New collection to an organiser, never to an admin who does not organise (R19)", async () => {
    let role: "admin" | "organiser" = "admin";
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, { forThisWeek: [], collections: [], recordingsCount: 0, savedCount: 0 });
      if (url === WEEK_URL) return json(200, week({ teams: [{ ...teamA, role }] }));
      return null;
    });
    const { unmount } = render(<TeachingResources demoMode={false} />);
    expect(await screen.findByRole("link", { name: /WA courses and modules are in CPD/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Hospital A psychiatry")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New collection" })).toBeNull();
    unmount();
    role = "organiser";
    render(<TeachingResources demoMode={false} />);
    expect(await screen.findByRole("button", { name: "New collection" })).toBeInTheDocument();
  });
});

describe("a collection page", () => {
  function serveCollection(teams: (typeof teamA)[]) {
    return serveFetch((url, body) => {
      if (url === COLLECTION_URL)
        return json(200, {
          collection: { collectionId: EXAM, serviceId: TEAM_A, name: "Exam prep" },
          sections: [{ sectionId: WRITTEN, name: "Written exam", sortOrder: 0 }],
          items: [item(), recording],
        });
      if (url === WEEK_URL) return json(200, week({ teams }));
      if (url === "/api/teaching/whats-on" && body?.action === "resource_save.set") return json(200, { saved: true });
      return null;
    });
  }

  it("groups by section, filters on the page without asking the server, and saves an item", async () => {
    const fetchMock = serveCollection([{ ...teamA, role: "doctor" }]);
    render(<TeachingCollection collection={EXAM} demoMode={false} />);
    expect(await screen.findByRole("heading", { name: "Written exam" })).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter this collection" }), { target: { value: "grand" } });
    expect(screen.queryByText("MCQ practice paper")).toBeNull();
    expect(screen.getByText("Grand round recording")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Save Grand round recording" }));
    expect(await screen.findByRole("button", { name: "Unsave Grand round recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a resource" })).toBeNull();
  });

  it("holds a removal for 10 seconds under Undo, hiding the item, then sends it with keepalive", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    const removals: Array<{ body: Record<string, unknown>; keepalive?: boolean }> = [];
    serveFetch((url, body, init) => {
      if (url === COLLECTION_URL)
        return json(200, {
          collection: { collectionId: EXAM, serviceId: TEAM_A, name: "Exam prep" },
          sections: [{ sectionId: WRITTEN, name: "Written exam", sortOrder: 0 }],
          items: [item(), recording],
        });
      if (url === WEEK_URL) return json(200, week({ teams: [{ ...teamA, role: "organiser" }] }));
      if (url === `/api/teaching/resources/services/${TEAM_A}` && body) {
        removals.push({ body, keepalive: init?.keepalive });
        return json(200, {});
      }
      return null;
    });
    render(<TeachingCollection collection={EXAM} demoMode={false} />);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    fireEvent.click(screen.getByRole("button", { name: "Remove items" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove MCQ practice paper" }));
    expect(screen.queryByText("MCQ practice paper")).toBeNull();
    expect(screen.getByTestId("teaching-collection-pending")).toHaveTextContent("Removing MCQ practice paper");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("MCQ practice paper")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(removals).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove MCQ practice paper" }));
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(removals).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(removals).toEqual([{ body: { action: "resource.remove", resourceId: item().resourceId }, keepalive: true }]);
  });

  it("offers Add a resource to an organiser of the collection's service", async () => {
    serveCollection([{ ...teamA, role: "organiser" }]);
    render(<TeachingCollection collection={EXAM} demoMode={false} />);
    expect(await screen.findByRole("button", { name: "Add a resource" })).toBeInTheDocument();
  });

  it("offers no Add to an admin of the service, or to an organiser of another service (R19)", async () => {
    serveCollection([
      { ...teamA, role: "admin" },
      { ...teamB, role: "organiser" },
    ]);
    render(<TeachingCollection collection={EXAM} demoMode={false} />);
    // The testing library's matcher folds the non-breaking space before "items" to a plain one.
    expect(await screen.findByText("Hospital A psychiatry · 2 items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a resource" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove items" })).toBeNull();
  });
});

describe("AddResourceSheet", () => {
  it("keeps Add disabled until the no-patient-details box is ticked, then sends the tick with the link", async () => {
    const posted: Record<string, unknown>[] = [];
    serveFetch((url, body) => {
      if (url === `/api/teaching/resources/services/${TEAM_A}` && body) {
        posted.push(body);
        return json(200, { resourceId: "12121212-1212-4212-8212-121212121212" });
      }
      return null;
    });
    const onAdded = vi.fn();
    render(
      <AddResourceSheet
        serviceId={TEAM_A}
        target={{ collectionId: EXAM }}
        sections={[{ sectionId: WRITTEN, name: "Written exam" }]}
        onClose={vi.fn()}
        onAdded={onAdded}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Exam syllabus" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), {
      target: { value: "https://example.org/syllabus" },
    });
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "No patient details in this file" }));
    fireEvent.click(add);
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(posted[0]).toEqual({
      action: "resource.add",
      title: "Exam syllabus",
      kind: "link",
      url: "https://example.org/syllabus",
      collectionId: EXAM,
      noPatientDetails: true,
    });
  });

  it("asks for the session when slides go into a collection, and keeps Add disabled until one is chosen (R27)", async () => {
    const posted: Record<string, unknown>[] = [];
    serveFetch((url, body) => {
      if (url === `/api/teaching/resources/services/${TEAM_A}` && body) {
        posted.push(body);
        return json(200, { resourceId: "12121212-1212-4212-8212-121212121212" });
      }
      return null;
    });
    const onAdded = vi.fn();
    render(
      <AddResourceSheet
        serviceId={TEAM_A}
        target={{ collectionId: EXAM }}
        sessions={[{ occurrenceId: OCC, label: "Wed 30 Sep 12:30–13:30 · Registrar teaching" }]}
        onClose={vi.fn()}
        onAdded={onAdded}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Exam prep slides" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), {
      target: { value: "https://example.org/slides" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "slides" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "No patient details in this file" }));
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: /Session/ }), { target: { value: OCC } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(posted[0]).toEqual({
      action: "resource.add",
      title: "Exam prep slides",
      kind: "slides",
      url: "https://example.org/slides",
      collectionId: EXAM,
      occurrenceId: OCC,
      noPatientDetails: true,
    });
  });

  it("refuses a link that is not https before sending anything", () => {
    const fetchMock = serveFetch(() => null);
    render(<AddResourceSheet serviceId={TEAM_A} target={{ occurrenceId: OCC }} onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Slides" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "http://example.org/s" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "No patient details in this file" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText("Use a link that starts with https://")).toBeInTheDocument();
    expect(fetchCalls(fetchMock, "/api/teaching/resources")).toBe(0);
  });
});

describe("SessionMaterials", () => {
  it("lists the session's materials with their type in words, and lets its presenter add one", async () => {
    serveFetch((url) =>
      url === `/api/teaching/resources?action=resources.read&occurrenceId=${OCC}`
        ? json(200, { items: [recording] })
        : null,
    );
    render(
      <SessionMaterials
        detail={detail({ isPresenter: true, materials: [{ label: "Reading list", url: "https://example.org/r" }] })}
      />,
    );
    const list = await waitFor(() => byId("teaching-session-materials"));
    expect(within(list).getByText("Reading list")).toBeInTheDocument();
    expect(await within(list).findByText("Recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add material" })).toBeInTheDocument();
  });

  it("offers no Add material to someone who is not the presenter", async () => {
    serveFetch((url) =>
      url === `/api/teaching/resources?action=resources.read&occurrenceId=${OCC}`
        ? json(200, { items: [recording] })
        : null,
    );
    render(<SessionMaterials detail={detail({ ...session(), isPresenter: false })} />);
    expect(await screen.findByText("Grand round recording")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add material" })).toBeNull();
  });
});
