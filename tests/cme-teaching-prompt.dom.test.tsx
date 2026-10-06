import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCmeTeachingUnloggedCount } from "@/components/cme/cme-teaching-prompt";

/** Shows the hook's count the way the Year page's "Teaching you gave" row does, or nothing. */
function CountProbe() {
  const count = useCmeTeachingUnloggedCount();
  return count === null ? null : <p data-testid="cme-teaching-count">{count}</p>;
}

afterEach(() => vi.unstubAllGlobals());

async function renderPrompt() {
  await act(async () => {
    render(<CountProbe />);
  });
}

describe("Teaching's unlogged count on CPD", () => {
  it("reads only a positive owner-scoped count from Teaching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 2 }) });
    vi.stubGlobal("fetch", fetchMock);

    await renderPrompt();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching?view=unlogged-count",
      expect.objectContaining({ method: "GET", credentials: "same-origin", signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByTestId("cme-teaching-count")).toHaveTextContent("2");
  });

  it.each([
    { name: "missing endpoint", response: { ok: false, status: 404 } },
    { name: "server error", response: { ok: false, status: 500 } },
    { name: "zero", response: { ok: true, json: async () => ({ count: 0 }) } },
    { name: "negative", response: { ok: true, json: async () => ({ count: -1 }) } },
    { name: "fraction", response: { ok: true, json: async () => ({ count: 1.5 }) } },
    { name: "string", response: { ok: true, json: async () => ({ count: "2" }) } },
    { name: "invalid body", response: { ok: true, json: async () => ({ total: 2 }) } },
  ])("hides when the Teaching count is $name", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await renderPrompt();
    expect(screen.queryByTestId("cme-teaching-count")).toBeNull();
  });

  it("hides on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await renderPrompt();
    expect(screen.queryByTestId("cme-teaching-count")).toBeNull();
  });
});
