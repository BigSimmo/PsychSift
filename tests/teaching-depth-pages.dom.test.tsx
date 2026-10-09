/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
// Teaching's sign-in notice offers the example, which refreshes the server pages.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { TeachingCpdReview } from "@/components/teaching/teaching-cpd-review";
import { TeachingFeedback } from "@/components/teaching/teaching-feedback";
import { TeachingImport } from "@/components/teaching/teaching-import";
import { TeachingSupervision } from "@/components/teaching/teaching-supervision";
import { TeachingTeach } from "@/components/teaching/teaching-teach";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { resetExampleDataForTests, setExampleDataOn, useExampleData } from "@/lib/example-data/store";
import { demoFeedbackOpen, demoSupervision } from "@/lib/teaching/depth-demo";
import { IMPORT_TEMPLATE_HEADERS, readinessLabels } from "@/lib/teaching/depth-model";
import { entry, pairingView, NOTE } from "./helpers/teaching-depth-fixtures";

const NB = "\u00a0";
const id = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const row = {
  occurrenceId: id,
  serviceName: "Demo service",
  title: "Demo grand round",
  startsAt: "2026-09-20T04:00:00Z",
  endsAt: "2026-09-20T05:00:00Z",
  hours: 1,
};
/** One talk still to prepare: room and slides ticked, the patient-details check open. */
const teachFixture = () => ({
  upcoming: [
    {
      occurrenceId: "33333333-3333-4333-8333-333333333333",
      serviceId,
      title: "Demo case-based discussion",
      startsAt: "2026-10-03T00:00:00.000Z",
      endsAt: "2026-10-03T00:45:00.000Z",
      venue: "Demo tutorial room",
      status: "scheduled",
      items: ["room", "slides_link"],
      deidConfirmedAt: null,
    },
  ],
  taught: [],
});
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const posts = () => vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST");

beforeEach(() => {
  auth.authEpoch = 1;
  auth.status = "authenticated";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Teaching depth journeys", () => {
  it("cancels queued organiser writes when the account changes or the page unmounts", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useDelayedPost());
    const job = {
      label: "Synthetic change",
      url: "/api/teaching/services/synthetic",
      body: {},
      onPosted: vi.fn(),
      onFailed: vi.fn(),
    };
    act(() => hook.result.current.schedule(job));
    auth.authEpoch++;
    hook.rerender();
    await act(async () => vi.advanceTimersByTimeAsync(10001));
    expect(posts()).toHaveLength(0);
    act(() => hook.result.current.schedule(job));
    auth.status = "loading";
    hook.rerender();
    expect(hook.result.current.pending).toBeNull();
    auth.status = "authenticated";
    hook.rerender();
    act(() => hook.result.current.schedule(job));
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(10001));
    expect(posts()).toHaveLength(0);
  });
  it("shows the proposed correction before the supervisor confirms it", async () => {
    const pairing = pairingView({
      access: "supervisor",
      entries: [
        entry({
          notes: [
            {
              noteId: NOTE,
              reason: "wrong_length",
              correctedValue: { minutes: 120 },
              confirmedAt: null,
              createdAt: "2026-09-27T00:00:00Z",
            },
          ],
        }),
      ],
    });
    vi.mocked(fetch).mockImplementation(async () => reply({ pairings: [pairing] }));
    render(<TeachingSupervision demoMode={false} />);
    expect(await screen.findByText("Proposed correction: Minutes: 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm correction" })).toBeEnabled();
    expect(posts()).toHaveLength(0);
  });

  it("serializes confirmations across pairings so a refresh cannot cancel another queued change", async () => {
    const pairings = [
      pairingView({ access: "supervisor", entries: [entry({ date: "2026-09-25" })] }),
      pairingView({ pairingId: id, access: "supervisor", entries: [entry({ entryId: id, date: "2026-09-26" })] }),
    ];
    vi.mocked(fetch).mockImplementation(async (_url, options) => reply(options?.method === "POST" ? {} : { pairings }));
    render(<TeachingSupervision demoMode={false} />);
    const first = await screen.findByRole("button", { name: "Confirm Fri 25 Sep" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(first);
    expect(screen.getByRole("button", { name: "Confirm Sat 26 Sep" })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm Sat 26 Sep" })).toBeEnabled();
  });
  it("requires explicit CPD selection and retains idempotency keys after an uncertain save", async () => {
    let writes = 0;
    vi.mocked(fetch).mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? ++writes === 1
          ? Promise.reject(new TypeError("network"))
          : reply({ results: [{ occurrenceId: id, entryId: id, code: null, message: null }] })
        : reply({ rows: [row] }),
    );
    render(<TeachingCpdReview demoMode={false} />);
    const choose = await screen.findByRole("checkbox");
    expect(choose).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Log selected sessions to my CPD" })).toBeDisabled();
    expect(posts()).toHaveLength(0);
    fireEvent.click(choose);
    fireEvent.click(screen.getByRole("button", { name: "Log selected sessions to my CPD" }));
    await screen.findByText(/Some entries may have saved/);
    const first = JSON.parse(String(posts()[0][1]?.body));
    fireEvent.click(screen.getByRole("button", { name: "Log selected sessions to my CPD" }));
    await screen.findByText("Saved to your private CPD log.");
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual(first);
    expect(first.rows[0]).toMatchObject({ occurrenceId: id, hours: 1 });
  });

  it("clears personal CPD choices when the account changes", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ rows: [row] }));
    const view = render(<TeachingCpdReview demoMode={false} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    auth.authEpoch++;
    vi.mocked(fetch).mockImplementation(async () => reply({ rows: [] }));
    view.rerender(<TeachingCpdReview demoMode={false} />);
    await screen.findByText("No attended sessions waiting to be logged.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("offers tap-only feedback, preserves answers after failure, and sends no identity field", async () => {
    const session = demoFeedbackOpen("2026-09-27")[0];
    let writes = 0;
    vi.mocked(fetch).mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? reply(++writes === 1 ? { error: "Unavailable" } : {}, writes === 1 ? 503 : 200)
        : reply({ sessions: [session] }),
    );
    render(<TeachingFeedback demoMode={false} />);
    fireEvent.click(await screen.findByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("radio", { name: "About right" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("radio", { name: "4" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByText("Thanks. Your answer was sent.");
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({
      action: "feedback.submit",
      occurrenceId: session.occurrenceId,
      useful: 4,
      pace: "right",
    });
  });

  it("cancels supervision confirmation during the ten-second undo period", async () => {
    const pairing = demoSupervision("2026-09-27")[1];
    vi.mocked(fetch).mockImplementation(async () => reply({ pairings: [pairing] }));
    render(<TeachingSupervision demoMode={false} />);
    const confirm = await screen.findByRole("button", { name: "Confirm Sat 26 Sep" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(confirm);
    await act(async () => vi.advanceTimersByTime(9999));
    expect(posts()).toHaveLength(0);
    expect(screen.getByTestId("teaching-supervision-pending")).toHaveClass("fixed");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => vi.advanceTimersByTime(10001));
    expect(posts()).toHaveLength(0);
    expect(screen.getByText("Cancelled before sending.")).toBeInTheDocument();
  });

  it("does not mark presenter readiness saved when the request fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) =>
      options?.method === "POST" ? reply({}, 503) : reply(teachFixture()),
    );
    render(<TeachingTeach demoMode={false} />);
    const aims = await screen.findByRole("checkbox", { name: "Aims written" });
    fireEvent.click(aims);
    await screen.findByRole("alert");
    expect(aims).not.toBeChecked();
  });

  it("previews rows before importing and prevents a blind repeat after an uncertain commit", async () => {
    const series = {
      title: "Demo session",
      repeat: "once",
      firstDate: "2026-09-28",
      startTime: "12:30",
      venue: "Demo room",
    };
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method !== "POST")
        return reply({ teams: [{ id: serviceId, name: "Demo service", role: "organiser" }] });
      const body = JSON.parse(String(options.body));
      return body.action === "import.preview"
        ? reply({ rows: [{ line: 2, title: "Demo session", errors: [] }], ready: [series] })
        : reply({}, 503);
    });
    render(<TeachingImport demoMode={false} />);
    const input = await screen.findByLabelText(/Choose CSV/);
    const file = new File([], "timetable.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: async () =>
        IMPORT_TEMPLATE_HEADERS.join(",") + "\nDemo session,lecture,once,2026-09-28,,12:30,60,Demo room,,",
    });
    fireEvent.change(input, { target: { files: [file] } });
    // Work-mode redesign, owner request 6 Oct 2026: the preview is a labelled section, with
    // "Nothing imported yet" as its right-hand note rather than part of a heading.
    await screen.findByTestId("teaching-import-preview");
    expect(screen.getByText("Nothing imported yet")).toBeInTheDocument();
    expect(screen.getByTestId("teaching-import-preview-when")).toHaveTextContent(
      "Mon 28 Sep · 12:30 Perth · Once · Demo room",
    );
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body)).action).toBe("import.preview");
    fireEvent.click(screen.getByRole("button", { name: "Import these sessions" }));
    await screen.findByText(/Check Organise before importing again/);
    expect(screen.queryByRole("button", { name: "Import these sessions" })).not.toBeInTheDocument();
  });

  it("keeps the synthetic depth demo away from all API writes", async () => {
    render(<TeachingFeedback demoMode />);
    // The demo owes feedback on two sessions, as My record says; answer the first.
    fireEvent.click((await screen.findAllByRole("radio", { name: "5" }))[0]);
    fireEvent.click(screen.getAllByRole("radio", { name: "About right" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Send feedback" })[0]);
    await waitFor(() => expect(screen.getByText("Demo answer recorded on this page.")).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a template with one made-up example row, and a styled service picker", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      reply({
        teams: [
          { id: serviceId, name: "Demo service", role: "organiser" },
          { id, name: "Demo second service", role: "admin" },
        ],
      }),
    );
    render(<TeachingImport demoMode={false} />);
    const template = await screen.findByRole("link", { name: "Download CSV template" });
    const csv = decodeURIComponent(template.getAttribute("href")!.replace("data:text/csv;charset=utf-8,", ""));
    expect(csv.split("\r\n").filter(Boolean)).toEqual([
      IMPORT_TEMPLATE_HEADERS.join(","),
      expect.stringMatching(/^Demo journal club,/),
    ]);
    expect(screen.getByRole("combobox", { name: "Service" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose CSV/)).toHaveAttribute("type", "file");
  });

  it("ticks readiness at once and keeps the page on screen while it refetches after the save", async () => {
    let reads = 0;
    let finishPost: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === "POST") return new Promise<Response>((resolve) => (finishPost = resolve));
      // The refetch after the save never answers, so the page must keep its data on screen.
      return ++reads === 1 ? reply(teachFixture()) : new Promise<Response>(() => {});
    });
    const view = render(<TeachingTeach demoMode={false} />);
    const aims = await screen.findByRole("checkbox", { name: "Aims written" });
    expect(aims).not.toBeChecked();
    fireEvent.click(aims);
    expect(aims).toBeChecked();
    await act(async () => finishPost(reply({ items: ["aims"], deidConfirmedAt: null })));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("checkbox", { name: "Aims written" })).toBeChecked();
    expect(view.container.querySelector("[data-skeleton-row]")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the readiness list usable while a tick saves, and sends the ticks one at a time", async () => {
    const finishPosts: Array<(response: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === "POST") return new Promise<Response>((resolve) => finishPosts.push(resolve));
      return reply(teachFixture());
    });
    render(<TeachingTeach demoMode={false} />);
    const aims = await screen.findByRole("checkbox", { name: "Aims written" });
    const reading = screen.getByRole("checkbox", { name: readinessLabels.reading_list });
    aims.focus();
    fireEvent.click(aims);
    expect(aims).toBeEnabled();
    expect(aims).toHaveFocus();
    fireEvent.click(reading);
    expect(aims).toBeChecked();
    expect(reading).toBeChecked();
    // The second tick waits for the first to finish, so the server sees them in order.
    expect(posts()).toHaveLength(1);
    await act(async () => finishPosts[0](reply({ items: ["room", "slides_link", "aims"], deidConfirmedAt: null })));
    await waitFor(() => expect(posts()).toHaveLength(2));
    // A server answer that predates a queued tick does not untick it.
    expect(reading).toBeChecked();
    await act(async () =>
      finishPosts[1](reply({ items: ["room", "slides_link", "aims", "reading_list"], deidConfirmedAt: null })),
    );
    expect(aims).toBeChecked();
    expect(reading).toBeChecked();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves focus to the confirmation once de-identification is confirmed", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? reply({ items: ["room", "slides_link"], deidConfirmedAt: "2026-09-27T01:00:00.000Z" })
        : reply(teachFixture()),
    );
    render(<TeachingTeach demoMode={false} />);
    const confirm = await screen.findByRole("button", { name: "I have checked that my material is de-identified" });
    confirm.focus();
    fireEvent.click(confirm);
    expect(await screen.findByText("De-identification confirmed.")).toHaveFocus();
  });

  it("rolls a failed readiness tick back and says so", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) =>
      options?.method === "POST" ? reply({}, 503) : reply(teachFixture()),
    );
    render(<TeachingTeach demoMode={false} />);
    const aims = await screen.findByRole("checkbox", { name: "Aims written" });
    fireEvent.click(aims);
    expect(aims).toBeChecked();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not saved\./);
    expect(aims).not.toBeChecked();
  });

  it("asks feedback with two tap rows of 48px radios, five for usefulness and three for pace", async () => {
    render(<TeachingFeedback demoMode />);
    const useful = await screen.findAllByRole("radiogroup", { name: "How useful was it? 1 (least) to 5 (most)" });
    const pace = screen.getAllByRole("radiogroup", { name: "Pace" });
    const radios = within(useful[0]).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      within(pace[0])
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Too slow", "About right", "Too fast"]);
    for (const radio of radios) expect(radio).toHaveClass("min-h-tap");
    fireEvent.click(radios[2]);
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("writes supervision in hours, labels and readable dates, with topics as chips capped at five", async () => {
    vi.mocked(fetch).mockImplementation(async () => reply({ pairings: [pairingView()] }));
    render(<TeachingSupervision demoMode={false} />);
    expect(await screen.findByText(/Confirmed: 1\sh · Pending: 1\.5\sh/)).toBeInTheDocument();
    const lines = Array.from(document.querySelectorAll("p"), (line) => line.textContent ?? "");
    expect(lines).toContain(`Mon 28 Sep · 90${NB}min · Group · Awaiting confirmation`);
    expect(lines).toContain(`Mon 21 Sep · 60${NB}min · Individual · Confirmed`);
    expect(screen.queryByText(/2026-09-28/)).toBeNull();
    expect(screen.getByRole("button", { name: "Correct Mon 28 Sep" })).toBeInTheDocument();
    const topics = ["case review", "risk", "psychotherapy", "formulation", "medication"];
    for (const topic of topics) fireEvent.click(screen.getByRole("button", { name: topic }));
    for (const topic of topics)
      expect(screen.getByRole("button", { name: topic })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "career" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "risk" }));
    expect(screen.getByRole("button", { name: "career" })).toBeEnabled();
  });
});

describe("Registrar supervision for a signed-out reader in the Assessments example", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetExampleDataForTests();
    auth.status = "signed_out";
  });
  afterEach(() => {
    window.localStorage.clear();
    resetExampleDataForTests();
  });

  it("shows the Teaching example, not a sign-in notice, before the server knows the switch is on", async () => {
    // The server read no example cookie yet (demoMode false), but the one switch is on for Assessments
    // and Teaching alike, so the page follows it at once and reads nothing from the account.
    expect(renderHook(() => useExampleData("assess")).result.current.active).toBe(true);
    render(<TeachingSupervision demoMode={false} />);
    expect((await screen.findAllByText("Dr Demo Supervisor")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Registrar supervision" })).toBeInTheDocument();
    expect(screen.queryByText("Sign in to see your teaching")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the same with the example explicitly on", async () => {
    act(() => setExampleDataOn(true));
    render(<TeachingSupervision demoMode={false} />);
    expect((await screen.findAllByText("Dr Demo Supervisor")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Sign in to see your teaching")).toBeNull();
  });

  it("asks a signed-out reader to sign in only once they turn the example off", async () => {
    act(() => setExampleDataOn(false));
    vi.mocked(fetch).mockImplementation(async () => reply({ error: "Sign in" }, 401));
    render(<TeachingSupervision demoMode={false} />);
    expect(await screen.findByText("Sign in to see your teaching")).toBeInTheDocument();
  });
});
