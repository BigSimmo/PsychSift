/** @vitest-environment jsdom */

// AdminRenewedSheet: the new-expiry-date sheet, final design (screens-v3).
// Handles both "Renewed" on an already-recorded catalogue/personal entry
// (PATCH) and "Add date" on a catalogue item never recorded before (POST),
// through the one component and the one body builder.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminRenewedSheet } from "@/components/admin/admin-renewed-sheet";
import type { AdminRequirementCatalogueItem } from "@/lib/admin/requirements";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

vi.mock("@/lib/admin/download-file", () => ({ downloadTextFile: vi.fn() }));
import { downloadTextFile } from "@/lib/admin/download-file";

const ENTRY = complianceFixture(
  "ALS course certification",
  { category: "training", expiresOn: "2026-10-14", requirementId: "als-course-certification" },
  { slug: "als" },
);

const CATALOGUE_ITEM: AdminRequirementCatalogueItem = {
  id: "criminal-record-screening",
  title: "Criminal record screening",
  group: "checks",
  status: "confirmed",
  sourceName: "WA Police",
  sourceUrl: "https://www.wa.gov.au",
  updated: "2026-09-26",
  rule: "Renews every three years.",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ entry: { ...ENTRY, details: { ...(ENTRY.details as object), expiresOn: "2030-10-14" } } }),
    ),
  );
});

describe("AdminRenewedSheet — renewing an already-recorded entry", () => {
  it("keeps Save grey until a valid date is typed, then PATCHes the entry", async () => {
    const onSaved = vi.fn();
    render(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={onSaved} onRemoved={vi.fn()} />);
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    expect(sheet.getByText(/Renewed: ALS course certification/)).toBeInTheDocument();
    const save = sheet.getByTestId("admin-renewed-save");
    expect(save).toBeDisabled();

    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    expect(sheet.getByText(/Mon 14 Oct 2030/)).toBeInTheDocument();
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await sheet.findByText("Marked renewed.")).toBeInTheDocument();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/on-call/entries/${ENTRY.id}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });

  it("never says the word 'checked' anywhere in the sheet", () => {
    render(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    const sheet = screen.getByTestId("admin-renewed-sheet");
    expect(sheet.textContent ?? "").not.toMatch(/\bchecked\b/i);
  });

  it("says when the new date is earlier than the one recorded before", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ entry: { ...ENTRY, details: { ...(ENTRY.details as object), expiresOn: "2026-01-01" } } }),
      ),
    );
    render(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2026-01-01" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    expect(await sheet.findByText(/earlier than the date recorded before/)).toBeInTheDocument();
  });

  it("offers Add to my calendar and Undo once saved", async () => {
    const onSaved = vi.fn();
    render(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={onSaved} onRemoved={vi.fn()} />);
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    await sheet.findByText("Marked renewed.");

    fireEvent.click(sheet.getByTestId("admin-renewed-calendar"));
    expect(downloadTextFile).toHaveBeenCalled();

    onSaved.mockClear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ entry: ENTRY })));
    fireEvent.click(sheet.getByTestId("admin-renewed-undo"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(ENTRY));
  });

  it("keeps a dismissed half-filled draft when reopened for the same entry", () => {
    const { rerender } = render(
      <AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />,
    );
    let sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });

    // Dismiss without saving, then reopen the SAME entry: the same component
    // instance stays mounted (no `key` change), so its half-typed date is
    // kept — Addendum A, "dismissed half-filled sheet is kept".
    rerender(<AdminRenewedSheet open={false} entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    rerender(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    sheet = within(screen.getByTestId("admin-renewed-sheet"));
    expect((sheet.getByLabelText("New expiry date") as HTMLInputElement).value).toBe("2030-10-14");
  });

  it("clears the form once a save has actually completed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <AdminRenewedSheet open entry={ENTRY} onClose={onClose} onSaved={vi.fn()} onRemoved={vi.fn()} />,
    );
    let sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    await sheet.findByText("Marked renewed.");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();

    rerender(<AdminRenewedSheet open={false} entry={ENTRY} onClose={onClose} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    rerender(<AdminRenewedSheet open entry={ENTRY} onClose={onClose} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    sheet = within(screen.getByTestId("admin-renewed-sheet"));
    expect((sheet.getByLabelText("New expiry date") as HTMLInputElement).value).toBe("");
  });

  it("keeps the typed date and offers Retry when the save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Save failed" }), { status: 500 }),
    );
    render(<AdminRenewedSheet open entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    await waitFor(() => expect(sheet.getByTestId("admin-renewed-save")).toHaveTextContent("Retry"));
    expect((sheet.getByLabelText("New expiry date") as HTMLInputElement).value).toBe("2030-10-14");
  });
});

describe("AdminRenewedSheet — Add date on a catalogue item never recorded", () => {
  it("opens blank, titled for a new date, and POSTs a new entry with the requirement id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entry: complianceFixture(
            CATALOGUE_ITEM.title,
            { category: CATALOGUE_ITEM.group, requirementId: CATALOGUE_ITEM.id, expiresOn: "2027-01-01" },
            { slug: "crs" },
          ),
        }),
      ),
    );
    const onSaved = vi.fn();
    render(
      <AdminRenewedSheet
        open
        entry={null}
        createItem={CATALOGUE_ITEM}
        onClose={vi.fn()}
        onSaved={onSaved}
        onRemoved={vi.fn()}
      />,
    );
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    expect(sheet.getByRole("heading", { name: "New expiry date" })).toBeInTheDocument();
    expect((sheet.getByLabelText("New expiry date") as HTMLInputElement).value).toBe("");
    expect(sheet.getByTestId("admin-renewed-save")).toBeDisabled();
    // No "recorded before" line for a brand-new item.
    expect(sheet.queryByText(/Recorded before/)).toBeNull();

    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2027-01-01" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/on-call/entries");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.details.requirementId).toBe("criminal-record-screening");
    expect(body.details.category).toBe("checks");
    // "Saved · Undo" for every save (M6): the new row can be taken back too.
    expect(within(screen.getByTestId("admin-renewed-sheet")).getByTestId("admin-renewed-undo")).toBeInTheDocument();
  });

  it("undoes a first-time date by deleting the row it created", async () => {
    const created = complianceFixture(
      CATALOGUE_ITEM.title,
      { category: CATALOGUE_ITEM.group, requirementId: CATALOGUE_ITEM.id, expiresOn: "2027-01-01" },
      { slug: "crs", id: "00000000-0000-4000-9000-0000000000cc" },
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: created }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, id: created.id })));
    const onRemoved = vi.fn();
    render(
      <AdminRenewedSheet
        open
        entry={null}
        createItem={CATALOGUE_ITEM}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onRemoved={onRemoved}
      />,
    );
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2027-01-01" } });
    fireEvent.click(sheet.getByTestId("admin-renewed-save"));
    fireEvent.click(await screen.findByTestId("admin-renewed-undo"));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(created.id));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/on-call/entries/${created.id}`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });
});
