/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/information-page-shell", () => ({
  InformationPageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/on-call/on-call-nav-header", () => ({ OnCallToolNavHeader: () => null }));
vi.mock("@/components/work-time/use-work-time-zone", () => ({ useWorkTimeZone: () => ({ zone: "Australia/Perth" }) }));
vi.mock("@/lib/on-call/entry-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/on-call/entry-store")>();
  return {
    ...actual,
    useOnCallEntries: () => ({
      entries: actual.readCachedOnCallEntries()?.entries ?? [],
      loading: false,
      isOffline: false,
      loadError: null,
      retry: () => {},
      cachedAt: null,
      signedOut: false,
      demoMode: false,
    }),
  };
});
import { OnCallCheckPage } from "@/components/on-call/on-call-check-page";
import { cacheOnCallEntries, clearOnCallEntryCache, readCachedOnCallEntries } from "@/lib/on-call/entry-store";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";
const A = onCallEntryFixture({
  section: "contacts",
  title: "Synthetic A private entry",
  updatedAt: "2026-11-05T00:00:00.123456+00:00",
  details: { role: "Synthetic contact", phone: "0000" },
  lastVerifiedAt: null,
});
const verified = { ...A, lastVerifiedAt: "2026-11-05T01:00:00Z" };
beforeEach(() => clearOnCallEntryCache());
afterEach(() => {
  cleanup();
  clearOnCallEntryCache();
  vi.restoreAllMocks();
});
it("same-account control: actual confirm button updates the real cache", async () => {
  cacheOnCallEntries([A]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: verified }));
  render(<OnCallCheckPage now={new Date("2026-11-05T02:00:00Z")} />);
  fireEvent.click(screen.getByRole("button", { name: "Still correct" }));
  await waitFor(() => expect(readCachedOnCallEntries()?.entries[0]?.lastVerifiedAt).toBe(verified.lastVerifiedAt));
});
it("rejects an actual unmounted confirm callback after the account cache is cleared", async () => {
  cacheOnCallEntries([A]);
  let resolveSave!: (value: Response) => void;
  const request = vi.spyOn(globalThis, "fetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveSave = resolve;
    }),
  );
  const page = render(<OnCallCheckPage now={new Date("2026-11-05T02:00:00Z")} />);
  fireEvent.click(screen.getByRole("button", { name: "Still correct" }));
  expect(request).toHaveBeenCalledWith(`/api/on-call/entries/${A.id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: A.updatedAt }),
  });
  page.unmount();
  clearOnCallEntryCache();
  expect(readCachedOnCallEntries()).toBeNull();
  // Same auth-transition cache invalidation function used by the real Auth provider.
  // No actual account or server mutation is simulated; the component's real callback resumes.
  await act(async () => {
    resolveSave(Response.json({ entry: verified }));
  });
  expect(readCachedOnCallEntries()).toBeNull();
});

it.each(["create", "patch", "delete"] as const)(
  "refuses a retained %s/undo dispatch from an old session",
  async (operation) => {
    const { createEntry, patchEntry, deleteEntry } = await import("@/components/admin/junior/junior-shared");
    const { peekOnCallEntrySessionEpoch } = await import("@/lib/on-call/entry-cache-keys");
    const epoch = peekOnCallEntrySessionEpoch();
    clearOnCallEntryCache();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: verified }));
    const promise =
      operation === "create"
        ? createEntry({}, epoch)
        : operation === "patch"
          ? patchEntry(A.id, {}, epoch)
          : deleteEntry(A.id, epoch);
    await expect(promise).rejects.toThrow("account changed");
    expect(request).not.toHaveBeenCalled();
  },
);

it.each([
  ["missing", {}],
  ["incomplete", { entry: { id: A.id } }],
  ["wrong id", { entry: { ...verified, id: "99999999-9999-4999-8999-999999999999" } }],
])("actual check action rejects a %s successful response without poisoning the cache", async (_name, payload) => {
  cacheOnCallEntries([A]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(payload));
  render(<OnCallCheckPage now={new Date("2026-11-05T02:00:00Z")} />);
  fireEvent.click(screen.getByRole("button", { name: "Still correct" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/response.*invalid.*try again/i));
  expect(readCachedOnCallEntries()?.entries).toEqual([A]);
});

it("refuses a versionless legacy row in Check these before verification dispatch", async () => {
  cacheOnCallEntries([{ ...A, updatedAt: undefined }]);
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: verified }));
  render(<OnCallCheckPage now={new Date("2026-11-05T02:00:00Z")} />);
  fireEvent.click(screen.getByRole("button", { name: "Still correct" }));
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/reload/i);
});
