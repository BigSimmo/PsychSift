/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminNewJobSharing, SHARE_WITH_WORKFORCE_LABEL } from "@/components/admin/new-job/admin-new-job-sharing";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminNewJobSharing", () => {
  it("is off by default, and says exactly what Medical Workforce would see", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(200, { share: false }));
    render(<AdminNewJobSharing />);
    const toggle = await screen.findByRole("switch", { name: SHARE_WITH_WORKFORCE_LABEL });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const what = screen.getByTestId("admin-new-job-sharing-what").textContent ?? "";
    expect(what).toContain("your name, team, start date, how many items are done, and the titles of items still to do");
    expect(what).toContain("Personal items are never shared");
    expect(what).toContain("You can turn this off any time");
    expect(what).not.toMatch(/[;→]/);
  });

  it("shows a skeleton while checking, and a failed read never looks like off", async () => {
    let answer: (response: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    render(<AdminNewJobSharing />);
    expect(screen.getByTestId("admin-new-job-sharing-loading")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    answer(json(500, { error: "Something went wrong." }));
    expect(await screen.findByTestId("admin-new-job-sharing-failed")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByTestId("admin-new-job-sharing-retry")).toBeTruthy();
  });

  it("turns sharing off with one save to the server", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => json(200, { share: true }))
      .mockImplementationOnce(async () => json(200, { share: false }));
    render(<AdminNewJobSharing />);
    const toggle = await screen.findByRole("switch", { name: SHARE_WITH_WORKFORCE_LABEL });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/work/starters/sharing",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ share: false }) }),
    );
  });

  it("says sharing is still on when turning it off fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => json(200, { share: true }))
      .mockImplementationOnce(async () => json(500, {}));
    render(<AdminNewJobSharing />);
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByTestId("admin-new-job-sharing-error")).toHaveTextContent("Sharing is still on.");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
