/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entriesState, items, personalContact, ready } from "./helpers/on-call-handbook-fixture";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

const handbook = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof ready> }));
const entries = vi.hoisted(() => ({
  list: [] as OnCallEntry[],
  signedOut: false,
  extra: {} as Record<string, unknown>,
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/call",
  useRouter: () => ({ push: vi.fn(), replace: router.replace, back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entriesState(entries.list, { signedOut: entries.signedOut, ...entries.extra }),
}));

import {
  onCallDidntConnectStorageKey,
  onCallHospitalPhoneStorageKey,
} from "@/components/on-call/call/call-device-stores";
import { onCallCallGroups, onCallRowBadge } from "@/components/on-call/call/call-groups";
import { OnCallCallPage } from "@/components/on-call/call/call-page";
import { onCallCallRoute } from "@/components/on-call/kit/dial-sheet";
import { clearOnCallDeviceState } from "@/lib/on-call/device-state-keys";
import { ISOBAR_SOURCE } from "@/lib/on-call/isobar-source";
import { resolveHandbookPhone } from "@/lib/on-call/number-resolver";

beforeEach(() => {
  window.localStorage.clear();
  handbook.state = ready(items([]));
  entries.list = [];
  entries.signedOut = false;
  entries.extra = {};
  router.replace.mockReset();
});
afterEach(cleanup);

/** People's Hospital / Outside lines / Mine switch. */
const showTab = (name: "Hospital" | "Outside lines" | "Mine") => userEvent.click(screen.getByRole("radio", { name }));

/** "Didn't connect" is marked from the number's own sheet: open the row's sheet, then tap the mark. */
async function markDidntConnect(rowTestId: string, id: string) {
  const row = screen.getByTestId(rowTestId);
  await userEvent.click(row.querySelector<HTMLButtonElement>("[data-dial-row-title]")!);
  await userEvent.click(screen.getByTestId(`on-call-didnt-connect-${id}`));
}

describe("Call page", () => {
  it("splits the hospital's numbers, outside lines and the reader's own across the Hospital / Outside lines / Mine switch", async () => {
    handbook.state = ready(
      items([
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
        { id: "w", title: "Ward: Synthetic ward 4B", phone: "4401" },
        { id: "i", title: "ICU: Registrar", phone: "4456" },
      ]),
    );
    entries.list = [personalContact("p1", "My consultant", "0400 000 111")];
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-hospital-line")).toHaveTextContent("Site A");
    expect(screen.getByRole("radio", { name: "Hospital" })).toHaveAttribute("aria-checked", "true");
    for (const slug of ["hospital", "icu", "wards", "general"]) {
      expect(document.getElementById(`on-call-group-${slug}`), slug).not.toBeNull();
    }
    expect(screen.getByTestId("on-call-call-group-general")).toHaveTextContent(/General · 1/i);
    expect(within(document.getElementById("on-call-group-wards")!).getByText("Synthetic ward 4B")).toBeInTheDocument();
    expect(document.getElementById("on-call-group-external")).toBeNull();
    expect(document.getElementById("on-call-group-mine")).toBeNull();

    await showTab("Outside lines");
    expect(document.getElementById("on-call-group-external")).not.toBeNull();
    expect(document.getElementById("on-call-group-hospital")).toBeNull();

    await showTab("Mine");
    expect(within(document.getElementById("on-call-group-mine")!).getByText("My consultant")).toBeInTheDocument();
    // The hospital's numbers are off screen on Mine, so the crisis lines show.
    expect(screen.getByTestId("on-call-crisis-lines")).toHaveTextContent("Lifeline");
    expect(
      within(document.getElementById("on-call-group-mine")!).getByRole("link", { name: "Your own numbers" }),
    ).toHaveAttribute("href", "/on-call/contacts");
    expect(screen.queryByText(/being built/i)).toBeNull();
  });

  it("orders Emergency, then departments, then Wards, then General with Switchboard first", () => {
    const groups = onCallCallGroups(
      items([
        { id: "g", title: "Interpreter service", phone: "9000 0050" },
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
        { id: "w", title: "Ward: Synthetic ward 4B", phone: "4401" },
        { id: "s", title: "Surgery: Registrar", phone: "9000 0015" },
        { id: "m", title: "Medicine: Registrar", phone: "9000 0012" },
        { id: "e", title: "Emergency: Synthetic emergency line", phone: "55" },
      ]),
    );
    expect(groups.map((group) => group.label)).toEqual(["Emergency", "Medicine", "Surgery", "Wards", "General"]);
    expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(["sw", "g"]);
  });

  it("dials an 8-digit hospital number with 08 and shows a short one as desk-only", () => {
    handbook.state = ready(
      items([
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
        { id: "i", title: "ICU: Registrar", phone: "4456" },
      ]),
    );
    render(<OnCallCallPage />);
    expect(screen.getByRole("link", { name: /^call switchboard, 9 0 0 0, 0 0 0 0$/i })).toHaveAttribute(
      "href",
      "tel:0890000000",
    );
    const icu = screen.getByTestId("on-call-call-row-i");
    expect(within(icu).getByText("From a hospital phone")).toBeInTheDocument();
    expect(within(icu).queryByRole("link", { name: /^call/i })).toBeNull();
  });

  it("pins the quiet red dot only on a site-named clinical emergency row", () => {
    handbook.state = ready(
      items([
        { id: "e1", title: "Emergency: Synthetic emergency line", phone: "55", kind: "clinical" },
        { id: "e2", title: "Emergency: Synthetic other line", phone: "56", kind: "operational" },
      ]),
    );
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-call-row-e1-emergency-dot")).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-call-row-e2-emergency-dot")).toBeNull();
  });

  it("gives a short extension a call disc only while the hospital-phone switch is on", async () => {
    handbook.state = ready(items([{ id: "i", title: "ICU: Registrar", phone: "4456" }]));
    render(<OnCallCallPage />);
    const icu = () => screen.getByTestId("on-call-call-row-i");
    expect(within(icu()).queryByRole("link", { name: /^call/i })).toBeNull();
    const toggle = screen.getByRole("switch", { name: "I'm on a hospital phone" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);
    expect(window.localStorage.getItem(onCallHospitalPhoneStorageKey)).toBe("1");
    expect(within(icu()).getByRole("link", { name: /^call registrar/i })).toHaveAttribute("href", "tel:4456");

    await userEvent.click(screen.getByRole("switch", { name: "I'm on a hospital phone" }));
    expect(within(icu()).queryByRole("link", { name: /^call/i })).toBeNull();
  });

  it("moves an own number to its after-hours line when the page is left open across 17:00", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      // A Tuesday, 30 seconds before the day period ends in the viewer's own zone.
      vi.setSystemTime(new Date(2026, 8, 29, 16, 59, 30));
      entries.list = [personalContact("p1", "My consultant", "0400 000 111", "0400 000 222")];
      render(<OnCallCallPage />);
      act(() => {
        screen.getByRole("radio", { name: "Mine" }).click();
      });
      const row = () => screen.getByTestId("on-call-call-mine-p1");
      expect(row()).toHaveTextContent("0400 000 111");
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(row()).toHaveTextContent("0400 000 222");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never gives a long number or a free-text number a different dial through the switch", () => {
    const direct = resolveHandbookPhone("9000 0012");
    const text = resolveHandbookPhone("ask switchboard");
    expect(onCallCallRoute(direct, null, true)).toBe(direct);
    expect(onCallCallRoute(text, null, true)).toBeNull();
    expect(onCallCallRoute(resolveHandbookPhone("4456"), null, false)).toBeNull();
    expect(onCallCallRoute(resolveHandbookPhone("4456"), null, true)?.tel).toBe("tel:4456");
  });

  it("never offers a bare extension as a mobile route in the dial sheet, even with the switch on", async () => {
    handbook.state = ready(items([{ id: "i", title: "ICU: Registrar", phone: "4456" }]));
    render(<OnCallCallPage />);
    await userEvent.click(screen.getByRole("switch", { name: "I'm on a hospital phone" }));
    await userEvent.click(screen.getByRole("button", { name: /^Registrar, .*Dialling details$/ }));

    const sheet = screen.getByTestId("on-call-call-row-i-sheet-body");
    expect(within(sheet).getByText("Not recorded")).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: /from your mobile/i })).toBeNull();
    expect(within(sheet).getByRole("link", { name: /from this hospital phone/i })).toHaveAttribute("href", "tel:4456");
    expect(within(sheet).getByTestId("on-call-hospital-phone-sheet")).toBeInTheDocument();
  });

  it("shows every outside line in the outside form, with its area, and its source and date one tap away", async () => {
    render(<OnCallCallPage />);
    await showTab("Outside lines");
    const external = document.getElementById("on-call-group-external")!;
    // One quiet line names every source with its https link, so no outside number shows without one.
    const sources = within(external).getByTestId("on-call-call-external-sources");
    for (const link of within(sources).getAllByRole("link")) {
      expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
    }
    expect(within(sources).getByRole("link", { name: /MHERL/ })).toBeInTheDocument();
    // Each number's own sheet carries its date and source.
    await userEvent.click(
      screen.getByTestId("on-call-call-external-wa-mherl").querySelector<HTMLButtonElement>("[data-dial-row-title]")!,
    );
    const sheet = screen.getByTestId("on-call-call-external-wa-mherl-sheet-body");
    expect(within(sheet).getByText(/^Updated \d{1,2} [A-Z][a-z]{2} \d{4}/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(external).toHaveTextContent("Perth metropolitan area and Peel");
    expect(external).toHaveTextContent("1300 555 788");
  });

  it("reports a handbook number with one of two fixed reasons, once, and never offers free text", async () => {
    handbook.state = ready(items([{ id: "i", title: "ICU: Registrar", phone: "4456" }]));
    render(<OnCallCallPage />);
    // No per-row button: the mark lives in the number's sheet.
    expect(screen.queryByTestId("on-call-didnt-connect-i")).toBeNull();
    await markDidntConnect("on-call-call-row-i", "i");
    const sheet = screen.getByRole("dialog", { name: "Didn't connect" });
    expect(screen.queryByTestId("on-call-call-row-i-sheet")).toBeNull();
    expect(within(sheet).queryByRole("textbox")).toBeNull();
    expect(
      within(sheet).getAllByRole("button", { name: /Number not in service|Reaches the wrong department/ }),
    ).toHaveLength(2);
    expect(within(sheet).queryByRole("button", { name: /no answer/i })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Number not in service" }));
    expect(handbook.state.report).toHaveBeenCalledWith("i", "not-in-service");
    expect(within(sheet).getByText("Sent to your hospital's editors.")).toBeInTheDocument();
    expect(screen.getByText(/^Didn't connect at \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(window.localStorage.getItem(onCallDidntConnectStorageKey)).not.toMatch(/4456/);
  });

  it("reads Reported, disabled, for a reason this phone already sent", async () => {
    handbook.state = ready(items([{ id: "i", title: "ICU: Registrar", phone: "4456" }]), {
      hasReported: vi.fn((_id: string, reason: string) => reason === "not-in-service"),
    });
    render(<OnCallCallPage />);
    await markDidntConnect("on-call-call-row-i", "i");
    const sheet = screen.getByRole("dialog", { name: "Didn't connect" });
    expect(within(sheet).getByRole("button", { name: "Reported" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Reaches the wrong department" })).toBeEnabled();
  });

  it("offers switchboard as the fallback, and clears the mark", async () => {
    handbook.state = ready(
      items([
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
        { id: "i", title: "ICU: Registrar", phone: "4456" },
      ]),
    );
    render(<OnCallCallPage />);
    await markDidntConnect("on-call-call-row-i", "i");
    const sheet = screen.getByRole("dialog", { name: "Didn't connect" });
    expect(within(sheet).getByRole("link", { name: /^call switchboard/i })).toHaveAttribute("href", "tel:0890000000");
    await userEvent.click(within(sheet).getByRole("button", { name: "Clear mark" }));
    expect(screen.queryByText(/^Didn't connect at/)).toBeNull();
  });

  it("only marks an outside line or the reader's own number; there is no one to report it to", async () => {
    entries.list = [personalContact("p1", "My consultant", "0400 000 111")];
    render(<OnCallCallPage />);
    for (const [tab, rowTestId, id] of [
      ["Outside lines", "on-call-call-external-wa-mherl", "wa-mherl"],
      ["Mine", "on-call-call-mine-p1", "p1"],
    ] as const) {
      await showTab(tab);
      await markDidntConnect(rowTestId, id);
      const sheet = screen.getByRole("dialog", { name: "Didn't connect" });
      expect(
        within(sheet).queryByRole("button", { name: /Number not in service|Reaches the wrong department/ }),
      ).toBeNull();
      expect(within(sheet).getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
    }
    expect(handbook.state.report).not.toHaveBeenCalled();
  });

  it("filters every group with one device-only search field", async () => {
    handbook.state = ready(
      items([
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
        { id: "i", title: "ICU: Registrar", phone: "4456" },
      ]),
    );
    render(<OnCallCallPage />);
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Search numbers, wards, roles");
    expect(screen.queryByRole("button", { name: /voice|microphone|dictat/i })).toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "icu");
    expect(screen.queryByText("Switchboard")).toBeNull();
    expect(screen.getByText("Registrar")).toBeInTheDocument();
    expect(document.getElementById("on-call-group-external")).toBeNull();
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("gives a cover extension the hospital-phone switch and filters cover with the Call search", async () => {
    const cover = items([{ id: "cov", title: "Cover", phone: "4457", section: "cover", kind: "clinical" }]).map(
      (item) => ({
        ...item,
        cover: { grade: "registrar" as const, team: "Psychiatry", window: { start: "00:00", end: "23:59" } },
      }),
    );
    handbook.state = ready([...cover, ...items([{ id: "i", title: "ICU: Registrar", phone: "4456" }])]);
    render(<OnCallCallPage />);
    const row = () => screen.getByTestId("on-call-call-cover-cov");
    expect(within(row()).queryByRole("link", { name: /^call/i })).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "I'm on a hospital phone" }));
    expect(within(row()).getByRole("link", { name: /^call/i })).toHaveAttribute("href", "tel:4457");

    await userEvent.type(screen.getByRole("searchbox"), "icu");
    expect(screen.queryByTestId("on-call-call-cover")).toBeNull();
    expect(screen.getByText("1 result")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "psychiatry");
    expect(row()).toBeInTheDocument();
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("shows the crisis lines, and no hospital numbers, while signed out", async () => {
    handbook.state = ready([], { status: "signed-out" });
    entries.signedOut = true;
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-handbook-state-signed-out")).toBeInTheDocument();
    const crisis = screen.getByTestId("on-call-crisis-lines");
    expect(within(crisis).getByRole("link", { name: /^call emergency services/i })).toHaveAttribute("href", "tel:000");
    expect(crisis).toHaveTextContent("Lifeline");
    expect(within(crisis).getByRole("heading", { name: "Public crisis lines" })).toBeInTheDocument();
    expect(within(crisis).getByTestId("on-call-crisis-line-syn-crisis-contact-002-caveat")).toHaveTextContent(
      "not an emergency service",
    );
    expect(screen.getByTestId("on-call-crisis-line-syn-crisis-contact-001-emergency-dot")).toBeInTheDocument();
    expect(document.getElementById("on-call-group-hospital")).toBeNull();
    expect(screen.queryByTestId("on-call-call-saved-note")).toBeNull();
    expect(screen.getByTestId("on-call-call-add")).toHaveAttribute("href", "/on-call/contacts");
    await showTab("Mine");
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
    expect(screen.getByText("Sign in to keep your own numbers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your own numbers" })).toHaveAttribute("href", "/on-call/contacts");
  });

  it("shows the crisis lines while loading and after a failed load", () => {
    for (const status of ["loading", "unavailable"] as const) {
      handbook.state = ready([], { status });
      render(<OnCallCallPage />);
      expect(screen.getByTestId("on-call-crisis-lines")).toHaveTextContent("13 11 14");
      cleanup();
    }
  });

  it("clears the lane's device stores at sign-out", () => {
    window.localStorage.setItem(onCallHospitalPhoneStorageKey, "1");
    window.localStorage.setItem(
      onCallDidntConnectStorageKey,
      JSON.stringify([{ entryId: "i", at: new Date().toISOString() }]),
    );
    clearOnCallDeviceState();
    expect(window.localStorage.getItem(onCallHospitalPhoneStorageKey)).toBeNull();
    expect(window.localStorage.getItem(onCallDidntConnectStorageKey)).toBeNull();
  });

  it("draws the consultant card only with a source", () => {
    render(<OnCallCallPage />);
    expect(screen.queryByTestId("on-call-call-isobar") === null).toBe(ISOBAR_SOURCE === null);
  });

  it("sends the old call-log link on to Now's Log a call sheet, keeping its query", () => {
    window.history.replaceState(null, "", "/on-call/call?from=my-day#on-call-call-log-heading");
    try {
      render(<OnCallCallPage />);
      expect(router.replace).toHaveBeenCalledWith("/on-call?from=my-day#log-a-call");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("sends My Day's old handover link on to the Handover page, keeping its query", () => {
    window.history.replaceState(null, "", "/on-call/call?from=my-day#on-call-handover-heading");
    try {
      render(<OnCallCallPage />);
      expect(router.replace).toHaveBeenCalledWith("/on-call/handover?from=my-day");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("does not redirect without the old call-log hash", () => {
    render(<OnCallCallPage />);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("no longer carries the call log or the handover builder", () => {
    render(<OnCallCallPage />);
    expect(screen.queryByTestId("on-call-call-handover")).toBeNull();
    expect(screen.queryByRole("button", { name: "Note this call" })).toBeNull();
  });

  it("says what the hospital-phone switch means, off and on", async () => {
    handbook.state = ready(items([{ id: "i", title: "ICU: Registrar", phone: "4456" }]));
    render(<OnCallCallPage />);
    const row = screen.getByTestId("on-call-hospital-phone");
    expect(row).toHaveTextContent("Off: you're on your mobile, so full numbers are dialled");
    await userEvent.click(screen.getByRole("switch", { name: "I'm on a hospital phone" }));
    expect(screen.getByTestId("on-call-hospital-phone")).toHaveTextContent(
      "On: you're on a hospital phone, so short extensions are dialled",
    );
  });

  it("reads a row's badge from its label only, and draws a shield on emergency rows", () => {
    const badges = Object.fromEntries(
      items([
        { id: "r", title: "Medicine: Registrar on call", phone: "9000 0012" },
        { id: "c", title: "Medicine: Consultant on call", phone: "9000 0013" },
        { id: "w2", title: "Ward: Ward 2 nurses", phone: "4021" },
        { id: "w4", title: "Ward: Synthetic ward 4B", phone: "4401" },
        { id: "p", title: "Pharmacy after hours", phone: "9000 0014" },
      ]).map((item) => [item.id, onCallRowBadge(item)]),
    );
    expect(badges).toEqual({ r: "REG", c: "CON", w2: "W2", w4: "4B", p: null });

    handbook.state = ready(
      items([
        { id: "e", title: "Emergency: Synthetic emergency line", phone: "55" },
        { id: "r", title: "Medicine: Registrar on call", phone: "9000 0012" },
      ]),
    );
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-call-row-r")).toHaveTextContent("REG");
    expect(screen.getByTestId("on-call-call-row-e").querySelector("svg.lucide-shield")).not.toBeNull();
  });

  it("counts a long group and offers Show all from its eyebrow", async () => {
    handbook.state = ready(
      items(
        Array.from({ length: 10 }, (_, index) => ({
          id: `w${index}`,
          title: `Ward: Synthetic ward ${index + 1}`,
          phone: `90000${String(index).padStart(3, "0")}`,
        })),
      ),
    );
    render(<OnCallCallPage />);
    const wards = screen.getByTestId("on-call-call-group-wards");
    expect(wards).toHaveTextContent(/Wards · 8 of 10/i);
    await userEvent.click(within(wards).getByRole("button", { name: "Show all 10 in Wards" }));
    expect(screen.getByTestId("on-call-call-group-wards")).toHaveTextContent(/Wards · 10/i);
    expect(within(screen.getByTestId("on-call-call-group-wards")).getAllByRole("listitem")).toHaveLength(10);
  });

  it("links Who's who, Pocket card and Numbers to check, counting only what Check these lists", () => {
    const never = { ...personalContact("p1", "Never checked", "0400 000 111"), lastVerifiedAt: null } as OnCallEntry;
    entries.list = [never, personalContact("p2", "Checked", "0400 000 222")];
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-call-whos-who")).toHaveAttribute("href", "/on-call/who-is-who");
    expect(screen.getByTestId("on-call-call-pocket-card")).toHaveAttribute("href", "/on-call/card");
    const check = screen.getByTestId("on-call-call-check");
    expect(check).toHaveAttribute("href", "/on-call/check");
    expect(check).toHaveTextContent("1 due for a check");
  });

  it("never states a check count when the reader's entries failed to load", () => {
    entries.list = [{ ...personalContact("p1", "Never checked", "0400 000 111"), lastVerifiedAt: null } as OnCallEntry];
    entries.extra = { loadError: "failed", isOffline: true };
    render(<OnCallCallPage />);
    expect(screen.getByTestId("on-call-call-check")).not.toHaveTextContent(/due for a check/);
  });

  it("says nothing matches, and that the hospital was not searched when it did not load", async () => {
    handbook.state = ready([], { status: "unavailable" });
    render(<OnCallCallPage />);
    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByTestId("on-call-call-nothing-found")).toHaveTextContent(
      "The hospital's numbers have not loaded",
    );
  });
});
