// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchRead: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/roster/use-roster-team", () => ({
  fetchRosterRead: mocks.fetchRead,
  postRosterAction: mocks.post,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

import { SwapAnswerCard, SwapFlowSheet } from "@/components/roster/swaps/swap-flow-sheet";
import { UNDO_MS } from "@/components/roster/swaps/use-delayed-roster-action";
import type { RosterAssignment, RosterSwap } from "@/lib/roster/team/model";

/*
 * The calendar-first swap flow: who, take back, check, send under a 10 second
 * Undo. Every person and time is invented; dates are far ahead so the shifts
 * are always still to come.
 */

const SERVICE = "5e000000-0000-4000-8000-000000000003";
const ME = "5e000000-0000-4000-8000-000000000001";
const SAM = "5e000000-0000-4000-8000-000000000002";
const NOOR = "5e000000-0000-4000-8000-000000000004";
const SWAP = "5e000000-0000-4000-8000-000000000005";

let counter = 0x100;
function shift(
  userId: string,
  name: string,
  grade: RosterAssignment["grade"],
  date: string,
  start: string,
  endDate: string,
  end: string,
  kind: RosterAssignment["kind"] = "day",
): RosterAssignment {
  return {
    id: `5e000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`,
    userId,
    name,
    grade,
    siteId: null,
    siteName: null,
    startsAt: `${date}T${start}:00+08:00`,
    endsAt: `${endDate}T${end}:00+08:00`,
    shiftCode: kind === "night" ? "N" : "D",
    kind,
  };
}

const give = shift(ME, "Alex Example", "registrar", "2030-03-12", "21:30", "2030-03-13", "08:00", "night");
const myOther = shift(ME, "Alex Example", "registrar", "2030-03-14", "08:00", "2030-03-14", "16:30");
const samEarly = shift(SAM, "Dr Sam Example", "registrar", "2030-03-11", "08:00", "2030-03-11", "16:30");
const samLate = shift(SAM, "Dr Sam Example", "registrar", "2030-03-13", "09:00", "2030-03-13", "17:00");
const samClashesWithMine = shift(SAM, "Dr Sam Example", "registrar", "2030-03-14", "09:00", "2030-03-14", "17:00");
const noorDay = shift(NOOR, "Dr Noor Example", "resident", "2030-03-11", "08:00", "2030-03-11", "16:30");

const overview = {
  service: { id: SERVICE, name: "Example team" },
  me: { role: "member", grade: "registrar", rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};
const reads = {
  assignments: { assignments: [give, myOther, samEarly, samLate, samClashesWithMine, noorDay] },
  overview,
  members: {
    members: [
      { userId: ME, name: "Alex Example", grade: "registrar" },
      { userId: SAM, name: "Dr Sam Example", grade: "registrar" },
      { userId: NOOR, name: "Dr Noor Example", grade: "resident" },
    ],
  },
};

const onSent = vi.fn();
const onClose = vi.fn();

function flowElement(mode: "swap" | "give_away" = "swap", shiftToGive = give, initialColleagueId?: string) {
  return (
    <SwapFlowSheet
      open
      onClose={onClose}
      serviceId={SERVICE}
      actorId={ME}
      give={shiftToGive}
      mode={mode}
      onSent={onSent}
      initialColleagueId={initialColleagueId}
    />
  );
}

function renderFlow(mode: "swap" | "give_away" = "swap", shiftToGive = give) {
  return render(flowElement(mode, shiftToGive));
}

async function toCheckStep() {
  await screen.findByText("Can swap");
  fireEvent.click(screen.getByRole("button", { name: /Dr Sam Example/ }));
  fireEvent.click(screen.getByRole("button", { name: "Nothing, just take my shift" }));
}

const swapCreate = {
  action: "swap.create",
  giveAssignmentId: give.id,
  counterpartyId: SAM,
  takeAssignmentId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  overview.settings.swapApproval = "auto_same_grade";
  auth.status = "authenticated";
  auth.authEpoch = 1;
  reads.assignments = { assignments: [give, myOther, samEarly, samLate, samClashesWithMine, noorDay] };
  reads.members = {
    members: [
      { userId: ME, name: "Alex Example", grade: "registrar" },
      { userId: SAM, name: "Dr Sam Example", grade: "registrar" },
      { userId: NOOR, name: "Dr Noor Example", grade: "resident" },
    ],
  };
  mocks.fetchRead.mockImplementation(async (_serviceId: string, what: string) => ({
    ok: true,
    data: reads[what as keyof typeof reads],
    readAt: new Date("2026-10-20T10:21:00Z"),
  }));
  mocks.post.mockResolvedValue({ ok: true, result: { swapId: SWAP, status: "requested" } });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SwapFlowSheet: who and take back", () => {
  it("lists a lower-grade colleague under Can't swap with the reason", async () => {
    renderFlow();
    await screen.findByText("Can swap");
    const cannot = screen.getByRole("heading", { name: "Can't swap" }).closest("section")!;
    expect(within(cannot).getByText("Dr Noor Example")).toBeTruthy();
    expect(within(cannot).getByText("Lower grade than this shift needs")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dr Sam Example/ })).toBeTruthy();
  });

  it("shows only the chosen colleague's compatible shifts, plus Nothing", async () => {
    renderFlow();
    await screen.findByText("Can swap");
    fireEvent.click(screen.getByRole("button", { name: /Dr Sam Example/ }));
    expect(screen.getByRole("button", { name: "Nothing, just take my shift" })).toBeTruthy();
    // Sam's 14 March shift overlaps one of mine, so it is left out.
    const choices = screen.getAllByRole("button").map((button) => button.textContent);
    expect(choices.filter((text) => /Mon 11 Mar|Wed 13 Mar/.test(text ?? ""))).toHaveLength(2);
    expect(choices.some((text) => /14 Mar/.test(text ?? ""))).toBe(false);
  });
});

describe("SwapFlowSheet: a colleague chosen before it opens", () => {
  it("starts at Take back when the chosen colleague can take the shift", async () => {
    render(flowElement("swap", give, SAM));
    expect(await screen.findByText("What would you take from Dr Sam Example?")).toBeTruthy();
    expect(screen.queryByText("Can swap")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Can swap")).toBeTruthy();
  });

  it("stays on Who when the chosen colleague can't take it", async () => {
    render(flowElement("swap", give, NOOR));
    await screen.findByText("Can swap");
    expect(screen.queryByText(/What would you take from/)).toBeNull();
    const cannot = screen.getByRole("heading", { name: "Can't swap" }).closest("section")!;
    expect(within(cannot).getByText("Dr Noor Example")).toBeTruthy();
  });

  it("lists a current member with no shifts in these weeks", async () => {
    const KAI = "5e000000-0000-4000-8000-000000000007";
    reads.members = {
      members: [...reads.members.members, { userId: KAI, name: "Dr Kai Example", grade: "registrar" }],
    };
    renderFlow();
    await screen.findByText("Can swap");
    expect(screen.getByRole("button", { name: /Dr Kai Example/ })).toBeTruthy();
    expect(screen.queryByText("Showing colleagues with shifts in these weeks.")).toBeNull();
  });
});

describe("SwapFlowSheet: check and send", () => {
  it("says a same-grade swap goes through once they accept", async () => {
    renderFlow();
    await toCheckStep();
    expect(screen.getByText("Goes through straight away once they accept.")).toBeTruthy();
    expect(screen.getByText("Rechecked 18:21")).toBeTruthy();
    expect(screen.getByLabelText("Your week after")).toBeTruthy();
  });

  it("says why the manager is needed when the team asks for approval", async () => {
    overview.settings.swapApproval = "manager";
    renderFlow();
    await toCheckStep();
    expect(
      screen.getByText("Needs your manager's approval because the team asks your manager to approve swaps"),
    ).toBeTruthy();
  });

  it("holds the send for 10 seconds with an Undo, and Undo sends nothing", async () => {
    renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    expect(screen.getByText("Sending in 10 seconds")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(UNDO_MS - 1));
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByText("Cancelled before sending.")).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("sends after 10 seconds with keepalive, then reports it and closes", async () => {
    renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, swapCreate, { keepalive: true });
    expect(onSent).toHaveBeenCalledWith("Swap sent");
    expect(onClose).toHaveBeenCalled();
  });

  it("sends nothing when the page is left during the hold", async () => {
    renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    await act(async () => vi.advanceTimersByTime(5_000));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await act(async () => vi.advanceTimersByTime(UNDO_MS));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("sends nothing when the window is closed during the hold", async () => {
    const { unmount } = renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    unmount();
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("shows the server's message when it refuses, and reads the roster again", async () => {
    mocks.post.mockResolvedValue({ ok: false, code: "roster_swap_clash", message: "Sam is already working then." });
    renderFlow();
    await toCheckStep();
    const readsBefore = mocks.fetchRead.mock.calls.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(screen.getByRole("alert").textContent).toBe("Sam is already working then.");
    expect(mocks.fetchRead.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The Send button is back after the refusal, and the message goes when the step changes.
    expect(screen.getByRole("button", { name: "Send swap request" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Sending and offers no second Send while the request is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(screen.getByText("Sending…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send swap request" })).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ ok: true, result: { swapId: SWAP, status: "requested" } });
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith("Swap sent");
  });

  it("says to sign in, and does not pretend to send, when nobody is signed in", async () => {
    auth.status = "signed_out";
    renderFlow();
    await toCheckStep();
    expect(screen.getByText("Sign in to send")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send swap request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancels the held send when the account changes", async () => {
    const { rerender } = renderFlow();
    await toCheckStep();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Send swap request" }));
    expect(screen.getByText("Sending in 10 seconds")).toBeTruthy();
    auth.authEpoch = 2;
    rerender(flowElement());
    expect(screen.queryByText("Sending in 10 seconds")).toBeNull();
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });
});

describe("SwapFlowSheet: give away", () => {
  it("offers the shift with open.post and its assignment id after the hold", async () => {
    renderFlow("give_away");
    await screen.findByText(/Who can take it: 1 person/);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Offer to 1 person" }));
    expect(screen.getByText("Sending in 10 seconds")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).toHaveBeenCalledWith(
      SERVICE,
      { action: "open.post", assignmentId: give.id },
      { keepalive: true },
    );
    expect(onSent).toHaveBeenCalledWith("Offered to Dr Sam Example");
  });
});

describe("SwapFlowSheet: a shift starting within 24 hours", () => {
  const soon = shift(ME, "Alex Example", "registrar", "2030-01-01", "08:00", "2030-01-01", "16:00");
  const urgentGive = {
    ...soon,
    startsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 10 * 3_600_000).toISOString(),
  };

  it("reports it to the manager with open.report, and Send works even with nobody free", async () => {
    reads.assignments = { assignments: [urgentGive] };
    renderFlow("give_away", urgentGive);
    expect(screen.getByRole("dialog", { name: "I can't make my shift" })).toBeTruthy();
    await screen.findByText("You still ring in as usual.");
    const button = screen.getByRole("button", { name: "I can't make it" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(button);
    expect(screen.getByText("Sending in 10 seconds")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(mocks.post).toHaveBeenCalledWith(
      SERVICE,
      { action: "open.report", assignmentId: urgentGive.id },
      { keepalive: true },
    );
    expect(onSent).toHaveBeenCalledWith("Your manager has been told");
  });
});

describe("SwapAnswerCard", () => {
  const theirs = shift(SAM, "Dr Sam Example", "registrar", "2030-03-20", "08:00", "2030-03-20", "16:30");
  const swap: RosterSwap = {
    id: SWAP,
    status: "requested",
    autoApproved: false,
    needsManagerBecause: null,
    cancelReason: null,
    requesterId: SAM,
    counterpartyId: ME,
    give: theirs,
    take: myOther,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2026-10-19T00:00:00Z",
    decidedAt: null,
    requesterName: "Dr Sam Example",
    counterpartyName: "Alex Example",
  };
  const done = vi.fn();

  it("shows what they give and get, and accepts", async () => {
    mocks.post.mockResolvedValueOnce({ ok: true, result: { swapId: SWAP, status: "accepted" } });
    render(<SwapAnswerCard swap={swap} serviceId={SERVICE} actorId={ME} onDone={done} />);
    expect(screen.getByText("You get")).toBeTruthy();
    expect(screen.getByText("You give")).toBeTruthy();
    await screen.findByLabelText("Your week after");
    fireEvent.click(screen.getByRole("button", { name: "Accept swap" }));
    await act(async () => {});
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "swap.accept", swapId: SWAP });
    expect(done).toHaveBeenCalledWith("Swap accepted");
  });

  it.each([
    [{ status: "approved", autoApproved: true }, "Swap approved itself"],
    [{ status: "cancelled", cancelReason: "roster_changed" }, "Swap cancelled: the roster changed"],
    [{ status: "cancelled", cancelReason: "no_longer_fits" }, "Swap cancelled: it no longer fits"],
    [{ status: "expired" }, "Swap expired before you accepted it"],
  ])("says what really happened when Accept comes back %o", async (result, words) => {
    mocks.post.mockResolvedValueOnce({ ok: true, result: { swapId: SWAP, ...result } });
    render(<SwapAnswerCard swap={swap} serviceId={SERVICE} actorId={ME} onDone={done} />);
    await screen.findByLabelText("Your week after");
    fireEvent.click(screen.getByRole("button", { name: "Accept swap" }));
    await act(async () => {});
    expect(done).toHaveBeenCalledWith(words);
    expect(done).not.toHaveBeenCalledWith("Swap accepted");
    expect(screen.queryByRole("button", { name: "Undo for 10 min" }) !== null).toBe(result.status === "approved");
  });

  it("reads Expired and offers no Accept once the swap has run out", () => {
    render(
      <SwapAnswerCard
        swap={{ ...swap, expiresAt: "2020-01-01T00:00:00Z" }}
        serviceId={SERVICE}
        actorId={ME}
        onDone={done}
      />,
    );
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept swap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("shows the refusal and reads the roster again when Accept is refused", async () => {
    mocks.post.mockResolvedValue({ ok: false, code: "roster_swap_gone", message: "That swap was withdrawn." });
    render(<SwapAnswerCard swap={swap} serviceId={SERVICE} actorId={ME} onDone={done} />);
    await screen.findByLabelText("Your week after");
    const readsBefore = mocks.fetchRead.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Accept swap" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe("That swap was withdrawn.");
    expect(mocks.fetchRead.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(done).not.toHaveBeenCalled();
  });

  it("declines", async () => {
    render(<SwapAnswerCard swap={swap} serviceId={SERVICE} actorId={ME} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await act(async () => {});
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "swap.decline", swapId: SWAP });
    expect(done).toHaveBeenCalledWith("Swap declined");
  });
});
