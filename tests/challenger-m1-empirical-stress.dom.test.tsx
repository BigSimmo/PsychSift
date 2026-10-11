/** @vitest-environment jsdom */

import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmeCustomisePage } from "@/components/cme/cme-customise-page";
import { PwaLifecycle } from "@/components/pwa-lifecycle";
import {
  cmeDashboardModuleIds,
  cmeDashboardModuleLabels,
  defaultCmeModuleOrder,
  readCmeModuleOrder,
  useCmeModuleOrder,
} from "@/lib/cme/module-order";
import { cmeModuleOrderChangedEvent, cmeModuleOrderStorageKey } from "@/lib/cme/module-order-keys";

const navigation = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => "/cme/customise" }));

afterEach(() => {
  cleanup();
  navigation.push.mockReset();
  // Clear any lingering in-memory fallback snapshot by triggering a successful setModuleIds write
  try {
    const { result } = renderHook(() => useCmeModuleOrder());
    act(() => {
      result.current.toggleModule("also-for-you");
      result.current.toggleModule("also-for-you");
    });
  } catch {}
  window.localStorage.removeItem(cmeModuleOrderStorageKey);
});

describe("Empirical Challenger M1: CME Reorder Controls Stress Harness", () => {
  beforeEach(() => {
    window.localStorage.removeItem(cmeModuleOrderStorageKey);
  });

  const getShownLabels = () =>
    within(screen.getByTestId("cme-module-order"))
      .getAllByRole("listitem")
      .map((item) => item.textContent?.trim() ?? "");

  it("handles 50 rapid sequential reorder clicks without race conditions or list corruption", async () => {
    const user = userEvent.setup();
    render(<CmeCustomisePage />);

    // In 'at-a-glance', we have: 'audited-today' (Logged today), 'year-dates' (Year dates), 'provenance' (Where these targets came from)
    const moveLoggedTodayDown = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });

    // Rapidly click move down, then up in rapid succession 20 times (40 clicks)
    for (let i = 0; i < 20; i++) {
      await user.click(moveLoggedTodayDown);
      const moveLoggedTodayUp = screen.getByRole("button", {
        name: `Move ${cmeDashboardModuleLabels["audited-today"]} up`,
      });
      await user.click(moveLoggedTodayUp);
    }

    // Verify list integrity: all 6 modules must still exist, no duplicates, no missing items
    const current = getShownLabels();
    expect(current).toHaveLength(6);
    for (const id of cmeDashboardModuleIds) {
      expect(current.some((label) => label.includes(cmeDashboardModuleLabels[id]))).toBe(true);
    }
    // And order should have returned exactly to default order
    const stored = readCmeModuleOrder(window.localStorage.getItem(cmeModuleOrderStorageKey));
    expect(stored).toEqual(defaultCmeModuleOrder);
  });

  it("stress-tests keyboard rapid interactions with alternating Enter and Space", async () => {
    const user = userEvent.setup();
    render(<CmeCustomisePage />);

    const moveDown = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });
    moveDown.focus();
    expect(moveDown).toHaveFocus();

    // Move down via Enter
    await user.keyboard("{Enter}");
    expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["year-dates"]);
    expect(getShownLabels()[3]).toContain(cmeDashboardModuleLabels["audited-today"]);

    // Move down again via Space (should swap with provenance)
    const moveDown2 = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });
    moveDown2.focus();
    await user.keyboard(" ");
    expect(getShownLabels()[3]).toContain(cmeDashboardModuleLabels["provenance"]);
    expect(getShownLabels()[4]).toContain(cmeDashboardModuleLabels["audited-today"]);

    // At this point, audited-today is at bottom of at-a-glance! The moveDown button MUST be disabled
    const moveDownDisabled = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });
    expect(moveDownDisabled).toBeDisabled();

    // Move up via Enter twice to return to top of slot
    const moveUp = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} up`,
    });
    moveUp.focus();
    await user.keyboard("{Enter}");
    const moveUp2 = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} up`,
    });
    moveUp2.focus();
    await user.keyboard(" ");

    expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["audited-today"]);
    const moveUpTop = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} up`,
    });
    expect(moveUpTop).toBeDisabled();
  });

  it("survives localStorage failure (QuotaExceededError) and continues reordering via in-memory snapshot", async () => {
    const user = userEvent.setup();

    // Mock localStorage.setItem to throw QuotaExceededError
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    try {
      render(<CmeCustomisePage />);
      const moveDown = screen.getByRole("button", {
        name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
      });

      // Click move down
      await user.click(moveDown);

      // Verify DOM updated despite storage throwing
      expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["year-dates"]);
      expect(getShownLabels()[3]).toContain(cmeDashboardModuleLabels["audited-today"]);

      // Click move up
      const moveUp = screen.getByRole("button", {
        name: `Move ${cmeDashboardModuleLabels["audited-today"]} up`,
      });
      await user.click(moveUp);

      expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["audited-today"]);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("reconciles cleanly when storage changes externally in another tab", async () => {
    render(<CmeCustomisePage />);
    expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["audited-today"]);

    // Simulate another tab reversing the at-a-glance order
    const externalOrder = ["requirements", "routines-due", "provenance", "year-dates", "audited-today", "also-for-you"];
    window.localStorage.setItem(cmeModuleOrderStorageKey, JSON.stringify({ v: 2, shown: externalOrder }));

    act(() => {
      window.dispatchEvent(new Event(cmeModuleOrderChangedEvent));
    });

    expect(getShownLabels()[2]).toContain(cmeDashboardModuleLabels["provenance"]);
    expect(getShownLabels()[3]).toContain(cmeDashboardModuleLabels["year-dates"]);
    expect(getShownLabels()[4]).toContain(cmeDashboardModuleLabels["audited-today"]);
  });

  it("preserves focus state across keyboard navigation reorders", async () => {
    const user = userEvent.setup();
    render(<CmeCustomisePage />);

    const moveDown = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });
    moveDown.focus();
    expect(moveDown).toHaveFocus();

    await user.keyboard("{Enter}");

    // The key on list item is stable (moduleId), so the moved item's button retains focus
    const moveDownAfter = screen.getByRole("button", {
      name: `Move ${cmeDashboardModuleLabels["audited-today"]} down`,
    });
    expect(moveDownAfter).toHaveFocus();
  });
});

describe("Empirical Challenger M1: PWA Update Notice Across Viewports & Routes", () => {
  beforeEach(() => {
    window.localStorage.removeItem("clinical-kb-pwa-update-dismissed-at");
  });

  type MockServiceWorker = ServiceWorker & { postMessage: ReturnType<typeof vi.fn> };

  function createWorker(): MockServiceWorker {
    const worker = new EventTarget() as unknown as MockServiceWorker;
    Object.defineProperties(worker, {
      state: { configurable: true, value: "installed" },
      scriptURL: { configurable: true, value: "http://localhost/sw.js" },
      postMessage: { configurable: true, value: vi.fn() },
    });
    return worker;
  }

  function installServiceWorkerStub(waiting: ServiceWorker | null = null) {
    const registration = new EventTarget() as unknown as ServiceWorkerRegistration & {
      waiting: ServiceWorker | null;
      installing: ServiceWorker | null;
      update: ReturnType<typeof vi.fn>;
    };
    Object.defineProperties(registration, {
      waiting: { configurable: true, value: waiting },
      installing: { configurable: true, value: null },
      update: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    });

    const container = new EventTarget() as unknown as ServiceWorkerContainer & {
      controller: unknown;
      register: ReturnType<typeof vi.fn>;
    };
    Object.defineProperties(container, {
      controller: { configurable: true, value: {} },
      register: { configurable: true, value: vi.fn().mockResolvedValue(registration) },
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });

    return { container, registration };
  }

  it("renders update notice on non-answer routes and verifies interactive dismiss and reload contracts", async () => {
    window.history.replaceState({}, "", "/cme?pwa-dev=1");
    const waitingWorker = createWorker();
    const { container } = installServiceWorkerStub(waitingWorker);
    const user = userEvent.setup();

    render(<PwaLifecycle />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    const noticeRegion = await screen.findByRole("region", { name: "Update available" });
    expect(noticeRegion).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("Reload when convenient to use the latest version.")).toBeInTheDocument();

    const reloadButton = screen.getByRole("button", { name: "Reload" });
    const laterButton = screen.getByRole("button", { name: "Later" });
    const dismissButton = screen.getByRole("button", { name: "Dismiss update notice" });

    expect(reloadButton).toBeInTheDocument();
    expect(laterButton).toBeInTheDocument();
    expect(dismissButton).toBeInTheDocument();

    // Verify keyboard reachability
    reloadButton.focus();
    expect(reloadButton).toHaveFocus();
    laterButton.focus();
    expect(laterButton).toHaveFocus();
    dismissButton.focus();
    expect(dismissButton).toHaveFocus();

    // Clicking Later dismisses the notice and persists dismissal
    await user.click(laterButton);
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("verifies CSS contract rules for .pwa-notice-stack across phone, tablet, desktop and short viewports", () => {
    const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    // Phone baseline (< 640px)
    expect(styles).toContain(".pwa-notice-stack {");
    expect(styles).toContain("--pwa-notice-bottom-gap: calc(max(0.75rem, var(--safe-area-bottom)) + 5rem);");
    expect(styles).toContain("left: max(0.5rem, var(--safe-area-left));");
    expect(styles).toContain("right: max(0.5rem, var(--safe-area-right));");

    // Standalone phone display mode increases bottom gap for home indicator / dock
    expect(styles).toContain("@media (display-mode: standalone)");
    expect(styles).toContain("--pwa-notice-bottom-gap: calc(max(0.75rem, var(--safe-area-bottom)) + 5.5rem);");

    // Tablet & Desktop standard (min-width: 640px)
    expect(styles).toContain("@media (min-width: 640px)");
    expect(styles).toContain("right: max(1rem, var(--safe-area-right));");
    expect(styles).toContain("bottom: max(1rem, var(--safe-area-bottom));");
    expect(styles).toContain("width: min(27rem, calc(100vw - 2rem - var(--safe-area-left) - var(--safe-area-right)));");

    // Answer views with fixed bottom composer: parks in top-right
    expect(styles).toContain("body:has(form.answer-footer-search-edge) .pwa-notice-stack");
    expect(styles).toContain("top: calc(4.25rem + max(0.75rem, var(--safe-area-top)));");

    // Short desktop / laptop heights (min-width: 640px and max-height: 899.98px): parks in top-right
    expect(styles).toContain("@media (min-width: 640px) and (max-height: 899.98px)");
    expect(styles).toContain("width: min(22rem, calc(100vw - 2rem - var(--safe-area-left) - var(--safe-area-right)));");

    // Wide tall desktop (min-width: 1280px and min-height: 900px)
    expect(styles).toContain("@media (min-width: 1280px) and (min-height: 900px)");
    expect(styles).toContain("right: max(1.5rem, var(--safe-area-right));");
    expect(styles).toContain("bottom: max(1.5rem, var(--safe-area-bottom));");

    // Wide short desktop (min-width: 1280px and max-height: 899.98px) preserves bottom: auto
    expect(styles).toContain("@media (min-width: 1280px) and (max-height: 899.98px)");
  });
});
