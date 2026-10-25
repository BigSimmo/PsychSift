/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HospitalShiftUpdates, sameHospitalName } from "@/components/on-call/now/hospital-shift-updates";
import { handbookItems, readyHandbook } from "./helpers/on-call-handbook-fixtures";
import type { OnCallShift } from "@/lib/roster/shifts/model";

const now = new Date("2026-09-27T02:00:00Z");
const shift = {
  id: "shift",
  startsAt: "2026-09-27T00:00:00Z",
  endsAt: "2026-09-27T08:00:00Z",
  title: "Synthetic shift",
  location: null,
  sourceUid: null,
  source: "manual",
  seriesId: null,
  workplace: "Other synthetic hospital",
} as OnCallShift;
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
describe("hospital and roster context", () => {
  it("prompts without silently changing the hospital, and permits keeping it", async () => {
    const handbook = readyHandbook([]);
    render(<HospitalShiftUpdates handbook={handbook} shifts={[shift]} now={now} />);
    expect(screen.getByTestId("on-call-roster-site-prompt")).toHaveTextContent("Other synthetic hospital");
    expect(handbook.changeHospital).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep this hospital" }));
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
  });
  it("remembers Keep this hospital for the rest of the shift, and asks again on the next", async () => {
    const handbook = readyHandbook([]);
    const first = render(<HospitalShiftUpdates handbook={handbook} shifts={[shift]} now={now} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep this hospital" }));
    first.unmount();
    // Now opened again during the same shift.
    render(<HospitalShiftUpdates handbook={handbook} shifts={[shift]} now={now} />);
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
    cleanup();
    // The next shift at the same place asks again.
    const next = { ...shift, startsAt: "2026-09-28T00:00:00Z", endsAt: "2026-09-28T08:00:00Z" };
    render(<HospitalShiftUpdates handbook={handbook} shifts={[next]} now={new Date("2026-09-28T02:00:00Z")} />);
    expect(screen.getByTestId("on-call-roster-site-prompt")).toBeInTheDocument();
  });
  it("treats a roster abbreviation or a dropped Hospital as the same place", () => {
    const handbook = { ...readyHandbook([]), siteName: "Synthetic Coast General Hospital" };
    const view = render(
      <HospitalShiftUpdates handbook={handbook} shifts={[{ ...shift, workplace: "SCGH" }]} now={now} />,
    );
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
    view.rerender(
      <HospitalShiftUpdates
        handbook={handbook}
        shifts={[{ ...shift, workplace: "Synthetic Coast General" }]}
        now={now}
      />,
    );
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
    view.rerender(
      <HospitalShiftUpdates
        handbook={handbook}
        shifts={[{ ...shift, workplace: "Synthetic Inland Hospital" }]}
        now={now}
      />,
    );
    expect(screen.getByTestId("on-call-roster-site-prompt")).toBeInTheDocument();
  });
  it("matches hospital names only on case, punctuation, filler words or exact initials", () => {
    expect(sameHospitalName("SCGH", "Synthetic Coast General Hospital")).toBe(true);
    expect(sameHospitalName("S.C.G.H.", "Synthetic Coast General Hospital")).toBe(true);
    expect(sameHospitalName("SCG", "Synthetic Coast General Hospital")).toBe(true);
    expect(sameHospitalName("TSCH", "The Synthetic Children's Hospital")).toBe(true);
    expect(sameHospitalName("synthetic coast general", "Synthetic Coast General Hospital")).toBe(true);
    expect(sameHospitalName("Synthetic Children’s", "Synthetic Childrens Hospital")).toBe(true);
    expect(sameHospitalName("Synthetic Coast", "Synthetic Coast General Hospital")).toBe(false);
    expect(sameHospitalName("SIH", "Synthetic Coast General Hospital")).toBe(false);
    expect(sameHospitalName("Hospital", "The Hospital")).toBe(false);
    expect(sameHospitalName("S", "Synthetic")).toBe(false);
  });
  it("does not guess between two overlapping workplaces or show data while loading", () => {
    const handbook = readyHandbook([]);
    const view = render(
      <HospitalShiftUpdates
        handbook={handbook}
        shifts={[shift, { ...shift, id: "two", workplace: "A third hospital" }]}
        now={now}
      />,
    );
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
    view.rerender(<HospitalShiftUpdates handbook={{ ...handbook, status: "loading" }} shifts={[shift]} now={now} />);
    expect(screen.queryByTestId("on-call-roster-site-prompt")).toBeNull();
  });
  it("lists only publication dates after the last completed shift, never an unknown date", () => {
    const items = handbookItems([
      { id: "changed", title: "Synthetic change" },
      { id: "old", title: "Old item" },
      { id: "unknown", title: "Unknown date" },
    ]).map((item) => ({
      ...item,
      updatedAt: item.id === "changed" ? "2026-09-26T23:00:00Z" : item.id === "old" ? "2026-09-25T00:00:00Z" : null,
    }));
    render(
      <HospitalShiftUpdates
        handbook={readyHandbook(items)}
        shifts={[{ ...shift, endsAt: "2026-09-26T22:00:00Z", startsAt: "2026-09-26T14:00:00Z" }]}
        now={now}
      />,
    );
    expect(screen.getByTestId("on-call-published-changes")).toHaveTextContent("Synthetic change");
    expect(screen.queryByText("Old item")).toBeNull();
    expect(screen.queryByText("Unknown date")).toBeNull();
  });
});
