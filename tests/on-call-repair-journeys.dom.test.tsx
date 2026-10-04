/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnCallContactsSection } from "@/components/on-call/on-call-contacts-section";
import { OnCallReferralsSection } from "@/components/on-call/on-call-referrals-section";
import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { focusOnCallEntryFromHash, onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { useOnCallLinkedDocuments } from "@/lib/on-call/linked-documents";
import { clearOnCallEntryCache } from "@/lib/on-call/entry-cache-keys";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

const id = "11111111-1111-4111-8111-111111111111";
const entry: OnCallEntry = {
  id,
  section: "contacts",
  slug: "ward",
  title: "Ward contact",
  subtitle: null,
  body: null,
  details: { role: "Registrar", extension: "0001" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: null,
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
  clearOnCallEntryCache();
});

describe("On call repair journeys", () => {
  it("offers an extension copy action and never an external dial link", () => {
    render(<OnCallContactsSection entries={[entry]} />);
    expect(screen.getByTestId("on-call-contact-row-ward")).not.toHaveAttribute("href");
    expect(screen.getByTestId("on-call-contact-row-ward")).toHaveTextContent("Ext 0001");
    expect(screen.getByRole("button", { name: "Copy extension for Ward contact" })).toBeInTheDocument();
    expect(document.querySelector('a[href="tel:0001"]')).toBeNull();
  });
  it("puts the role full width and the phone on the line below, outside the dial/copy column", () => {
    render(<OnCallContactsSection entries={[{ ...entry, details: { role: "Registrar", phone: "08 9224 1000" } }]} />);
    const row = screen.getByTestId("on-call-contact-row-ward");
    const number = row.querySelector("[data-contact-row-number]");
    expect(number).not.toBeNull();
    expect(number).toHaveTextContent("08 9224 1000");
    // Role-first: the number is under the title in the text column, not stacked
    // beside it via the old phone-only flex-col trailing slot.
    expect(row).not.toHaveClass("flex-col");
    expect(row).toHaveAttribute("href", "tel:0892241000");
    expect(row).not.toContainElement(screen.getByRole("button", { name: /Copy Direct number/ }));
  });

  it("preserves full role names and escalation conditions in wrapping text", () => {
    render(
      <OnCallEntryRow
        title="Long unbroken role name"
        subtitle="Only after the documented escalation condition has been met"
      />,
    );
    for (const text of ["Long unbroken role name", "Only after the documented escalation condition has been met"]) {
      const node = screen.getByText(text);
      expect(node.className).toContain("break-words");
      expect(node.className).not.toMatch(/truncate|line-clamp/);
    }
  });
  it("opens and focuses the exact referral entry from its stable anchor", () => {
    render(
      <OnCallReferralsSection
        entries={[{ ...entry, section: "referrals", details: { accepts: ["Adults"], exclusions: [] } }]}
      />,
    );
    const target = document.getElementById(onCallEntryAnchorId(id))!;
    expect(target.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    history.replaceState(null, "", `/#${onCallEntryAnchorId(id)}`);
    act(focusOnCallEntryFromHash);
    expect(target).toHaveFocus();
    expect(target.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    expect(screen.getByText("Adults")).toBeVisible();
  });
  it("does not fetch a document library when no source is linked", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useOnCallLinkedDocuments([]));
    expect(result.current).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requests only exact linked IDs and clears titles when the source set changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ document: { id, title: "Approved source", updated_at: null } }));
    const { result, rerender } = renderHook(({ ids }) => useOnCallLinkedDocuments(ids), {
      initialProps: { ids: [id, id] },
    });
    await waitFor(() => expect(result.current[id]?.title).toBe("Approved source"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/documents/${id}?pageLimit=1&chunkLimit=1&assetScope=window`);
    rerender({ ids: [] });
    expect(result.current).toEqual({});
  });
  it("leaves an inaccessible linked source unresolved", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useOnCallLinkedDocuments([id]));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({});
  });

  it("resolves clinical review date from metadata rather than file timestamps", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        document: {
          id,
          title: "Clinical Guideline",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2026-09-20T00:00:00Z",
          // The public document route strips metadata before sending the response.
        },
        publicReviewDate: "2025-06-30",
      }),
    );
    const { result } = renderHook(() => useOnCallLinkedDocuments([id]));
    await waitFor(() => expect(result.current[id]?.date).toBe("2025-06-30"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves camelCase reviewDate from metadata when review_date is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        document: {
          id,
          title: "Clinical Guideline",
          updated_at: "2026-09-20T00:00:00Z",
          metadata: { reviewDate: "2025-07-15" },
        },
      }),
    );
    const { result } = renderHook(() => useOnCallLinkedDocuments([id]));
    await waitFor(() => expect(result.current[id]?.date).toBe("2025-07-15"));
  });

  it("never falls back to updated_at or created_at when metadata has no review date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        document: {
          id,
          title: "Clinical Guideline",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2026-09-20T00:00:00Z",
          metadata: { unrelated: "value" },
        },
      }),
    );
    const { result } = renderHook(() => useOnCallLinkedDocuments([id]));
    await waitFor(() => expect(result.current[id]?.title).toBe("Clinical Guideline"));
    expect(result.current[id]?.date).toBeNull();
  });
});
