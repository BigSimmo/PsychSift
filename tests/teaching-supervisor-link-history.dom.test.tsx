/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), forget: vi.fn() }));
vi.mock("@/lib/shared-get", () => ({ forgetSharedGets: mocks.forget }));
vi.mock("@/lib/teaching/client", () => ({
  teachingGet: mocks.get,
  teachingPost: mocks.post,
  teachingErrorMessage: () => "Links unavailable",
}));
vi.mock("@/lib/example-data/store", () => ({ useExampleData: () => ({ active: false }) }));
import { SupervisorLinkPanel } from "@/components/teaching/assessments/supervisor-link-panel";
import type { EpaMagicLinkSummary } from "@/lib/teaching/assessments/magic-link-repository";

const waiting: EpaMagicLinkSummary = {
  id: "older-waiting",
  epaCode: "EPA 1",
  epaTitle: "Synthetic EPA",
  supervisorName: "Dr Waiting Example",
  supervisorRole: "consultant",
  createdAt: "2026-10-20T00:00:00Z",
  expiresAt: "2026-11-20T00:00:00Z",
  status: "pending",
  completedAt: null,
  submission: null,
};
const recent = { ...waiting, id: "recent", supervisorName: "Dr Recent Example", status: "revoked" as const };
const older = { ...recent, id: "older", supervisorName: "Dr Older Example" };
const initial = { links: [waiting, recent], nextCursor: "synthetic-cursor" };
const mount = () => render(<SupervisorLinkPanel epa={1} guest={null} defaultTraineeName="" />);

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("owner supervisor-link history", () => {
  it("keeps an older waiting link cancellable while loading older history without duplicates", async () => {
    mocks.get.mockResolvedValueOnce(initial).mockResolvedValueOnce({ links: [waiting, older], nextCursor: null });
    const user = userEvent.setup();
    mount();
    await screen.findByText("EPA 1 · Dr Waiting Example");
    expect(screen.getByRole("button", { name: "Cancel link" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load older links" }));
    await screen.findByText("EPA 1 · Dr Older Example");
    expect(within(screen.getByTestId("epa-sent-links")).getAllByRole("listitem")).toHaveLength(3);
    expect(mocks.get).toHaveBeenLastCalledWith(expect.stringContaining("cursor=synthetic-cursor"));
    expect(screen.queryByRole("button", { name: "Load older links" })).toBeNull();
  });

  it("preserves loaded links when an older history page fails and offers a retry", async () => {
    mocks.get.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("synthetic outage"));
    const user = userEvent.setup();
    mount();
    await screen.findByText("EPA 1 · Dr Recent Example");
    await user.click(screen.getByRole("button", { name: "Load older links" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Older links could not be read");
    expect(screen.getByText("EPA 1 · Dr Recent Example")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older links" })).toBeEnabled();
  });

  it("discards an older page started before a successful cancellation refresh", async () => {
    let release!: (value: unknown) => void;
    mocks.get
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ links: [recent], nextCursor: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    mount();
    await screen.findByText("EPA 1 · Dr Waiting Example");
    await user.click(screen.getByRole("button", { name: "Load older links" }));
    await user.click(screen.getByRole("button", { name: "Cancel link" }));
    await waitFor(() => expect(screen.queryByText("EPA 1 · Dr Waiting Example")).toBeNull());
    release({ links: [waiting, older], nextCursor: null });
    await waitFor(() => expect(screen.queryByText("EPA 1 · Dr Older Example")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/older-waiting"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("forgets in-flight link reads after a cancellation, before the refresh read starts", async () => {
    mocks.get.mockResolvedValueOnce(initial).mockResolvedValueOnce({ links: [recent], nextCursor: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    mount();
    await screen.findByText("EPA 1 · Dr Waiting Example");
    await user.click(screen.getByRole("button", { name: "Cancel link" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(mocks.forget).toHaveBeenCalledWith("/api/teaching/assessments/magic-links");
    expect(mocks.forget.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[1]);
  });
});
