/** @vitest-environment jsdom */

// Now while On Call shows example data (owner decision, 6 Oct 2026; the one
// switch since 7 Oct): a plain label that the crisis lines are real, the real
// public crisis lines first, then the mock-up's Now drawn from invented data.
// The frame's example data banner says "made up" (not mounted here). Nothing is
// fetched or saved, and no made-up number is a link.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isOnCallPlaceholderNumber, onCallTelHref } from "@/lib/on-call/number-resolver";

const auth = vi.hoisted(() => ({ status: "signed_out", authEpoch: 1 }));
const nav = vi.hoisted(() => ({ pathname: "/on-call" }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-sign-in-dialog" /> : null),
}));

const { OnCallHome } = await import("@/components/on-call/on-call-home");
const { resetExampleDataForTests, setExampleDataOn } = await import("@/lib/example-data/store");
const { ON_CALL_NOW_EXAMPLE, ON_CALL_NOW_EXAMPLE_NUMBERS } =
  await import("@/components/on-call/now/signed-out-example");

describe("On Call Now, signed out", () => {
  beforeEach(() => {
    auth.status = "signed_out";
    nav.pathname = "/on-call";
    window.localStorage.clear();
    resetExampleDataForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderExample() {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<OnCallHome />);
    const example = await screen.findByTestId("on-call-now-example");
    return { fetchSpy, setItem, example };
  }

  it("labels the crisis lines as real, for signed-out and ended sessions", async () => {
    await renderExample();
    const label = screen.getByTestId("on-call-now-real-lines");
    expect(label.textContent).toBe(
      "These crisis lines are real. Everything after them is made up and cannot be called.",
    );
    cleanup();

    auth.status = "expired";
    render(<OnCallHome />);
    expect(screen.getByTestId("on-call-now-real-lines")).toBeTruthy();
  });

  it("puts the real public crisis lines first, above every made-up row", async () => {
    const { example } = await renderExample();
    const label = screen.getByTestId("on-call-now-real-lines");
    const crisis = screen.getByTestId("on-call-now-crisis");
    // label, then crisis lines, then the example.
    expect(label.compareDocumentPosition(crisis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(crisis.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The crisis lines keep their real, callable numbers.
    const crisisLinks = [...crisis.querySelectorAll("a[href^='tel:']")].map((link) => link.getAttribute("href"));
    expect(crisisLinks).toContain("tel:000");
    expect(crisisLinks).toContain("tel:131114");
  });

  it("draws every made-up number as text, never as a tel: link or a button", async () => {
    const { example } = await renderExample();
    expect(example.querySelectorAll("a, button")).toHaveLength(0);
    const drawn = [...example.querySelectorAll("[data-example-number]")].map((node) => node.textContent);
    expect(drawn.sort()).toEqual([...ON_CALL_NOW_EXAMPLE_NUMBERS].sort());
    for (const number of ON_CALL_NOW_EXAMPLE_NUMBERS) {
      expect(number).toMatch(/^0000 000 0\d\d$/);
      expect(isOnCallPlaceholderNumber(number)).toBe(true);
      expect(onCallTelHref(number)).toBeUndefined();
    }
    // No tel: link anywhere on the page points at a placeholder.
    for (const link of document.querySelectorAll("a[href^='tel:']")) {
      expect(link.getAttribute("href")).not.toMatch(/^tel:0000/);
    }
    expect(example.textContent).toContain(ON_CALL_NOW_EXAMPLE.hospital);
    expect(example.textContent).toContain("Dr Alex Example");
    expect(example.textContent).toContain("Dr Robin Wattle");
  });

  it("fetches nothing and saves nothing", async () => {
    const { fetchSpy, setItem } = await renderExample();
    await act(async () => {});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("follows the example data switch: off means the live page, signed out too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: [], signedOut: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    act(() => setExampleDataOn(false));
    render(<OnCallHome />);
    await act(async () => {});
    expect(screen.queryByTestId("on-call-now-example")).toBeNull();
    expect(screen.queryByTestId("on-call-now-real-lines")).toBeNull();
  });
});
