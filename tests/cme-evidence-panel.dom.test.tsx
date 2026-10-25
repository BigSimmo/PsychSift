/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmeEvidencePanel } from "@/components/cme/cme-evidence-panel";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const entryId = "11111111-1111-4111-8111-111111111111";
const evidence = {
  id: "22222222-2222-4222-8222-222222222222",
  entryId,
  fileName: "Synthetic certificate.pdf",
  contentType: "application/pdf",
  byteSize: 100,
  kind: "certificate",
  uploadedAt: "2026-09-22T00:00:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  nav.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ evidence: [] })));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic-preview"), revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Private evidence attachment journey", () => {
  it("requires preview and confirmation, retains a failed selection, then refreshes missing-evidence counts", async () => {
    const user = userEvent.setup();
    const fetcher = vi.mocked(fetch);
    fetcher
      .mockResolvedValueOnce(json({ evidence: [] }))
      .mockResolvedValueOnce(json({ message: "Connection interrupted. Refresh before retrying." }, 503))
      .mockResolvedValueOnce(json({ evidence, duplicate: true }));
    render(<CmeEvidencePanel entryId={entryId} />);
    await screen.findByText("No evidence attached yet.");
    await user.click(screen.getByText("Attach evidence"));
    await user.upload(
      screen.getByLabelText(/File — PDF/),
      new File(["%PDF-1.7\n%%EOF"], evidence.fileName, { type: "application/pdf" }),
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload evidence" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Open file preview" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByRole("button", { name: "Upload evidence" })).toBeEnabled();
    expect(nav.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    expect(await screen.findByText(/no duplicate was created/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `Download ${evidence.fileName}` })).toHaveAttribute(
      "href",
      `/api/cme/entries/${entryId}/evidence/${evidence.id}`,
    );
    expect(nav.refresh).toHaveBeenCalledOnce();
    const sent = fetcher.mock.calls[1][1]?.body as FormData;
    expect(sent.get("previewConfirmed")).toBe("true");
    expect(sent.get("redactionConfirmed")).toBe("true");
  });

  it("distinguishes unavailable evidence from an empty list and allows recovery", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ message: "Evidence unavailable" }, 503))
      .mockResolvedValueOnce(json({ evidence: [] }));
    const user = userEvent.setup();
    render(<CmeEvidencePanel entryId={entryId} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("No evidence attached yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Refresh evidence" }));
    expect(await screen.findByText("No evidence attached yet.")).toBeInTheDocument();
  });

  it("allows retained evidence downloads for archived records without an upload control", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ evidence: [evidence] }));
    render(<CmeEvidencePanel entryId={entryId} readOnly />);
    expect(await screen.findByRole("link", { name: `Download ${evidence.fileName}` })).toBeInTheDocument();
    expect(screen.queryByText("Attach evidence")).toBeNull();
  });

  it("removes a file only with a reason, even on an archived record, and keeps the reason as the record", async () => {
    const user = userEvent.setup();
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(json({ evidence: [evidence] })).mockResolvedValueOnce(
      json({
        evidence: {
          ...evidence,
          fileName: "Removed file",
          removedAt: "2026-09-24T01:00:00Z",
          removalReason: "Shows a patient name",
        },
      }),
    );
    render(<CmeEvidencePanel entryId={entryId} readOnly />);
    await user.click(await screen.findByRole("button", { name: `Remove ${evidence.fileName}` }));
    const confirm = screen.getByRole("button", { name: "Remove file" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/why are you removing this file/i), "Shows a patient name");
    await user.click(confirm);
    expect(await screen.findByText(/File removed on 24 September 2026/)).toBeInTheDocument();
    expect(screen.getByText("Reason: Shows a patient name")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe(`/api/cme/entries/${entryId}/evidence/${evidence.id}`);
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "Shows a patient name" });
  });

  it("keeps Remove file off while the reason reads like patient details", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ evidence: [evidence] }));
    render(<CmeEvidencePanel entryId={entryId} readOnly />);
    await user.click(await screen.findByRole("button", { name: `Remove ${evidence.fileName}` }));
    await user.type(screen.getByLabelText(/why are you removing this file/i), "Saw John Smith, 45 with low mood");
    expect(screen.getByTestId(`cme-evidence-remove-reason-catch-${evidence.id}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not request personal evidence in a demo", async () => {
    render(<CmeEvidencePanel entryId={entryId} demoMode />);
    await waitFor(() => expect(screen.getByText("Demo evidence is not stored.")).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });
});
