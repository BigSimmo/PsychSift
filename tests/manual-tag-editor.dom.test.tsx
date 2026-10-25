import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentManualTagEditor } from "@/components/document-viewer/manual-tag-editor";
import type { ClinicalDocument, DocumentLabel } from "@/lib/types";

function manualLabel(overrides: Partial<DocumentLabel> = {}): DocumentLabel {
  return {
    id: "label-1",
    document_id: "doc-1",
    label: "Existing tag",
    label_type: "topic",
    source: "manual",
    confidence: 1,
    ...overrides,
  };
}

// The editor only reads `id` and `labels`; a minimal cast keeps the fixture focused.
function makeDocument(labels: DocumentLabel[] = []): ClinicalDocument {
  return { id: "doc-1", labels } as unknown as ClinicalDocument;
}

const baseProps = {
  canManage: true,
  clientDemoMode: false,
  authorizationHeader: {} as Record<string, string>,
  onLabelsUpdated: () => {},
  onUnauthorized: () => {},
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DocumentManualTagEditor", () => {
  it("keeps Add disabled until the tag meets the server's 2-char minimum and caps length at 64", () => {
    render(<DocumentManualTagEditor document={makeDocument()} {...baseProps} />);
    const input = screen.getByLabelText("Manual tag") as HTMLInputElement;
    const addButton = screen.getByRole("button", { name: "Add" });

    expect(addButton).toBeDisabled();
    fireEvent.change(input, { target: { value: " a " } }); // 1 non-space char
    expect(addButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "ab" } });
    expect(addButton).toBeEnabled();
    expect(input.maxLength).toBe(64);
  });

  it("requires an explicit second click to confirm a delete before issuing the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ labels: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentManualTagEditor document={makeDocument([manualLabel()])} {...baseProps} />);

    // First click only asks for confirmation — no destructive request yet.
    fireEvent.click(screen.getByRole("button", { name: "Remove Existing tag" }));
    expect(fetchMock).not.toHaveBeenCalled();

    // Cancelling backs out cleanly, still no request.
    fireEvent.click(screen.getByRole("button", { name: "Cancel removing Existing tag" }));
    expect(fetchMock).not.toHaveBeenCalled();

    // Confirming fires the DELETE.
    fireEvent.click(screen.getByRole("button", { name: "Remove Existing tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Existing tag" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("keeps a double-click on the initial Remove control from reaching the destructive confirm", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ labels: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentManualTagEditor document={makeDocument([manualLabel()])} {...baseProps} />);

    const removeButton = screen.getByRole("button", { name: "Remove Existing tag" });
    fireEvent.click(removeButton);

    // The original Remove hit target is replaced by a non-action prompt, and the destructive
    // control is a separately-labelled button rendered after it — so the second click of a
    // rapid double-click on the old Remove position cannot confirm the delete.
    expect(screen.queryByRole("button", { name: "Remove Existing tag" })).toBeNull();
    expect(screen.getByText("Remove this tag?")).toBeTruthy();
    fireEvent.click(removeButton); // stale/detached node — must not issue a request
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes a 401 to onUnauthorized without also raising an inline error banner", async () => {
    const onUnauthorized = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentManualTagEditor document={makeDocument()} {...baseProps} onUnauthorized={onUnauthorized} />);
    fireEvent.change(screen.getByLabelText("Manual tag"), { target: { value: "new tag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    // The generic error banner must not also render the server message.
    expect(screen.queryByText("Unauthorized")).toBeNull();
  });

  it("announces a failed tag change to screen readers as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "That tag already exists." }),
      }),
    );

    render(<DocumentManualTagEditor document={makeDocument()} {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Manual tag"), { target: { value: "new tag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That tag already exists.");
  });
});
