/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeaveWalletPage } from "@/components/admin/leave/leave-wallet-page";
import { BOTH_REMINDERS_ON, CONTRACT_END_SLUG_PREFIX, reminderFields } from "@/lib/admin/contract-end";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

const search = vi.hoisted(() => ({ value: "" }));
// Like the real router, a replace changes what useSearchParams reads next.
const router = vi.hoisted(() => ({
  replace: vi.fn((url: string) => {
    search.value = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  }),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/leave",
  useRouter: () => ({ push: router.push, replace: router.replace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: (text: string) => copyText(text) }));

const entryState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: vi.fn(),
}));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: vi.fn(),
}));

const NOW = new Date("2026-10-06T01:00:00Z");
let leavePayload: unknown = { leave: [] };

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

beforeEach(() => {
  entryState.entries = [];
  search.value = "";
  router.replace.mockClear();
  copyText.mockClear();
  leavePayload = { leave: [] };
  setOnline(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(leavePayload), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("LeaveWalletPage", () => {
  it("shows eight cards, the sign-off banner and the agreement link", () => {
    render(<LeaveWalletPage now={NOW} />);
    expect(within(screen.getByTestId("admin-leave-stack")).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByTestId("admin-leave-sign-off").textContent).toContain("Figures from your agreement");
    expect(screen.queryByTestId("admin-leave-agreement-end")).toBeNull();
    expect(screen.getByTestId("admin-leave-agreement").getAttribute("href")).toMatch(/^https:\/\//);
    expect(screen.getByTestId("admin-leave-back").getAttribute("href")).toBe("/admin");
  });

  it("opens a card on top, with the rest as a thin pile", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-annual"));
    expect(screen.getByTestId("admin-leave-open-annual")).toBeTruthy();
    const entitlement = screen.getByTestId("admin-leave-annual-entitlement").textContent;
    expect(entitlement).toContain("160 hours a year full time");
    expect(entitlement).toContain("Clause 34(1)");
    expect(entitlement).toContain("Check your agreement");
    expect(entitlement).not.toContain("Not signed off yet");
    expect(screen.getByTestId("admin-leave-pile").textContent).toContain("7 more cards");
    expect(router.replace).toHaveBeenCalledWith("/admin/leave?card=annual", { scroll: false });
  });

  it("splits professional development leave by doctors in training and senior practitioners", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-conference"));
    const entitlement = screen.getByTestId("admin-leave-conference-entitlement").textContent;
    expect(entitlement).toContain("Doctors in training");
    expect(entitlement).toContain("Senior practitioners");
    expect(entitlement).toContain("Clause 18(3)");
    expect(entitlement).toContain("Clause 30(1)(a), 30(1)(c)");
  });

  it("says when the agreement has reached its end date", () => {
    render(<LeaveWalletPage now={new Date("2027-09-10T01:00:00Z")} />);
    expect(screen.getByTestId("admin-leave-agreement-end").textContent).toContain(
      "stays in force until a new one is made",
    );
  });

  it("fills the annual message, copies it, and shows Roster bookings", async () => {
    leavePayload = {
      leave: [{ id: "a", kind: "annual", startsOn: "2026-12-21", endsOn: "2027-01-04", status: "applied" }],
    };
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-annual"));
    expect(await screen.findByText("Applied")).toBeTruthy();
    expect(screen.getByTestId("admin-leave-annual-gaps").textContent).toContain("2 gaps to fill");
    fireEvent.change(screen.getByTestId("admin-leave-annual-first"), { target: { value: "2026-11-09" } });
    fireEvent.change(screen.getByTestId("admin-leave-annual-last"), { target: { value: "2026-11-13" } });
    expect(screen.getByTestId("admin-leave-annual-message").textContent).toContain("from Mon 9 Nov to Fri 13 Nov");
    fireEvent.click(screen.getByTestId("admin-leave-annual-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining("Mon 9 Nov")));
  });

  it("keeps Copy off while a date error stands", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-exam"));
    fireEvent.change(screen.getByTestId("admin-leave-exam-first"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByTestId("admin-leave-exam-last"), { target: { value: "2026-11-09" } });
    expect(screen.getByText("Last day is before the first day.")).toBeTruthy();
    expect((screen.getByTestId("admin-leave-exam-copy") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("admin-leave-exam-email")).toBeNull();
  });

  it("catches a record number in an edited personal leave message", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-personal"));
    fireEvent.click(screen.getByTestId("admin-leave-personal-edit-toggle"));
    fireEvent.change(screen.getByTestId("admin-leave-personal-edit"), {
      target: { value: "Hi, I am unwell. Patient UMRN 7654321 needs a review." },
    });
    expect(screen.getByTestId("admin-leave-personal-message-problem")).toBeTruthy();
    expect((screen.getByTestId("admin-leave-personal-copy") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the confidential card discreet and out of the address bar", () => {
    render(<LeaveWalletPage now={NOW} />);
    const front = screen.getByTestId("admin-leave-card-confidential");
    expect(front.textContent).toContain("Confidential leave");
    expect(front.textContent).not.toMatch(/violence/i);
    fireEvent.click(front);
    expect(screen.getByTestId("admin-leave-open-confidential").textContent).toContain(
      "Family and domestic violence leave",
    );
    expect(router.replace).toHaveBeenLastCalledWith("/admin/leave", { scroll: false });
    expect(screen.getByTestId("admin-leave-confidential-help").textContent).toContain("never offered in search");
  });

  it("hides the confidential card with Undo and a hidden cards row", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-confidential"));
    fireEvent.click(screen.getByTestId("admin-leave-hide"));
    expect(screen.queryByTestId("admin-leave-card-confidential")).toBeNull();
    expect(within(screen.getByTestId("admin-leave-stack")).getAllByRole("button")).toHaveLength(7);
    expect(screen.getByTestId("admin-leave-hidden").textContent).toContain("1 hidden card");
    expect(screen.getByTestId("admin-leave-hidden").textContent).not.toMatch(/confidential|violence/i);
    fireEvent.click(screen.getByTestId("admin-leave-undo-undo"));
    expect(screen.getByTestId("admin-leave-card-confidential")).toBeTruthy();
    expect(screen.queryByTestId("admin-leave-hidden")).toBeNull();
  });

  it("brings hidden cards back with Show", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-confidential"));
    fireEvent.click(screen.getByTestId("admin-leave-hide"));
    fireEvent.click(screen.getByTestId("admin-leave-show-hidden"));
    expect(screen.getByTestId("admin-leave-card-confidential")).toBeTruthy();
  });

  it("links the parental card to the contract end and its question", () => {
    const fields = reminderFields("2027-01-31", BOTH_REMINDERS_ON);
    entryState.entries = [
      complianceFixture(
        "Contract end",
        { category: "Personal", expiresOn: "2027-01-31", leadTimeDays: fields.leadTimeDays },
        { slug: `${CONTRACT_END_SLUG_PREFIX}x1` },
      ),
    ];
    search.value = "card=parental";
    render(<LeaveWalletPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-entry").textContent).toContain("Ends Sun 31 Jan 2027");
    expect(screen.getByTestId("admin-leave-parental-question").getAttribute("href")).toBe(
      "/admin/contract?question=parental-leave",
    );
    expect(screen.getByTestId("admin-leave-parental-message").textContent).toContain("which ends on Sun 31 Jan");
  });

  it("says offline honestly and keeps Copy working", async () => {
    setOnline(false);
    render(<LeaveWalletPage now={NOW} />);
    expect(screen.getByTestId("admin-leave-offline").textContent).toContain("The cards and Copy still work");
    fireEvent.click(screen.getByTestId("admin-leave-card-long-service"));
    fireEvent.click(screen.getByTestId("admin-leave-long-service-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
  });

  it("says Roster leave could not load rather than nothing booked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-conference"));
    expect(await screen.findByText("Could not load your leave from Roster.")).toBeTruthy();
  });

  it("asks a signed-out reader to sign in, and never asks Roster", () => {
    Object.assign(entryState, { signedOut: true });
    try {
      render(<LeaveWalletPage now={NOW} />);
      fireEvent.click(screen.getByTestId("admin-leave-card-annual"));
      expect(screen.getByTestId("admin-leave-annual-booked-signed-out")).toHaveTextContent(
        "Sign in to see what Roster holds.",
      );
      expect(screen.queryByText("Could not load your leave from Roster.")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      Object.assign(entryState, { signedOut: false });
    }
  });

  it("opens the confidential card from a link, then takes its name out of the address", () => {
    search.value = "card=confidential";
    render(<LeaveWalletPage now={NOW} />);
    expect(screen.getByTestId("admin-leave-open-confidential")).toBeTruthy();
    expect(router.replace).toHaveBeenCalledWith("/admin/leave", { scroll: false });
    expect(search.value).not.toContain("confidential");
  });

  it("keeps the agreement link a plain working link offline, with the reason in the banner", () => {
    setOnline(false);
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-annual"));
    const link = within(screen.getByTestId("admin-leave-annual-entitlement")).getByRole("link", {
      name: /Check your agreement/,
    });
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("admin-leave-offline")).toHaveTextContent("Links open when you are back online");
  });

  it("stacks the two date fields on a narrow phone", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-annual"));
    const first = screen.getByLabelText("First day");
    const row = first.closest(".grid.gap-2");
    expect(row?.className).toContain("min-[360px]:grid-cols-2");
    expect(row?.className.split(" ")).not.toContain("grid-cols-2");
  });

  it("closes the card and puts focus back on its header", () => {
    render(<LeaveWalletPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-leave-card-exam"));
    fireEvent.click(screen.getByTestId("admin-leave-close"));
    expect(document.activeElement).toBe(screen.getByTestId("admin-leave-card-exam"));
  });
});
