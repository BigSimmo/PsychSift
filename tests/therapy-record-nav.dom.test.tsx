import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTherapyRecordNavSections,
  TherapyRecordNavHeader,
  THERAPY_RECORD_DESTINATIONS,
} from "@/components/therapy-compass/therapy-record-nav-header";
import type { Therapy } from "@/components/therapy-compass/data/types";
import { withTopBarLeadingSlot } from "./helpers/top-bar-slot";

const bindings = vi.hoisted(() => ({
  open: vi.fn(),
  openSheet: vi.fn(),
  openBrief: vi.fn(),
  goCompare: vi.fn(),
  removeCompare: vi.fn(),
  inCompare: false,
}));

vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    open: bindings.open,
    openSheet: bindings.openSheet,
    openBrief: bindings.openBrief,
    goCompare: bindings.goCompare,
    removeCompare: bindings.removeCompare,
    isInCompare: () => bindings.inCompare,
    workspaceHref: (href: string) => href,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/therapy-compass/behavioural-activation-ba",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const therapy = {
  slug: "behavioural-activation-ba",
  name: "Behavioural Activation (BA)",
  category: "Standard Talking Therapies",
  aliases: ["BA"],
  tags: ["Mood"],
  reviewStatus: "needs_review",
  patientSheetAvailable: true,
  briefInterventionAvailable: true,
} as Therapy;

function renderHeader(record: Therapy = therapy, saved = false, onToggleSave = vi.fn()) {
  return render(
    <TherapyRecordNavHeader
      therapy={record}
      active="overview"
      backHref="/therapy-compass/search"
      backLabel="Therapy search"
      testIdPrefix="therapy-detail"
      saved={saved}
      onToggleSave={onToggleSave}
    />,
  );
}

beforeEach(() => {
  bindings.inCompare = false;
  for (const value of Object.values(bindings)) if (typeof value === "function") value.mockReset();
});
afterEach(cleanup);

describe("therapy record header", () => {
  withTopBarLeadingSlot();

  it("names every available destination in the visible rail", () => {
    renderHeader();
    const rail = screen.getByTestId("therapy-detail-section-rail");

    for (const label of ["Overview", "Info sheet", "Brief", "Compare"]) {
      expect(within(rail).getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it("omits a destination this record has no artefact for, rather than offering a dead route", () => {
    const sparse = { ...therapy, patientSheetAvailable: false, briefInterventionAvailable: false };
    expect(buildTherapyRecordNavSections(sparse).map((section) => section.id)).toEqual(["overview", "compare"]);

    renderHeader(sparse);
    const rail = screen.getByTestId("therapy-detail-section-rail");
    expect(within(rail).queryByRole("button", { name: /^Info sheet/ })).toBeNull();
    expect(within(rail).queryByRole("button", { name: /^Brief/ })).toBeNull();
  });

  it("gives the rail equal weights that always sum to one", () => {
    for (const record of [therapy, { ...therapy, briefInterventionAvailable: false }]) {
      const sections = buildTherapyRecordNavSections(record);
      const total = sections.reduce((sum, section) => sum + (section.weight ?? 0), 0);
      expect(total).toBeCloseTo(1, 10);
      for (const section of sections) expect(section.weight).toBe(1 / sections.length);
    }
  });

  it("routes each destination to that therapy's own page", async () => {
    const user = userEvent.setup();
    renderHeader();
    const rail = screen.getByTestId("therapy-detail-section-rail");

    await user.click(within(rail).getByRole("button", { name: /^Info sheet/ }));
    expect(bindings.openSheet).toHaveBeenCalledWith(therapy.slug);

    await user.click(within(rail).getByRole("button", { name: /^Brief/ }));
    expect(bindings.openBrief).toHaveBeenCalledWith(therapy.slug);
  });

  // Every other slot in this rail is a destination, and this one now is too.
  // It used to add the therapy when it was absent from the set and navigate
  // when it was present — the same tap doing two different things depending on
  // state the reader could not see. Adding moved to the record's own button.
  it("navigates to the comparison whether or not the therapy is in it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderHeader();

    await user.click(
      within(screen.getByTestId("therapy-detail-section-rail")).getByRole("button", { name: /^Compare/ }),
    );
    expect(bindings.goCompare).toHaveBeenCalledTimes(1);
    expect(bindings.removeCompare).not.toHaveBeenCalled();
    unmount();

    bindings.inCompare = true;
    bindings.goCompare.mockReset();
    renderHeader();
    await user.click(
      within(screen.getByTestId("therapy-detail-section-rail")).getByRole("button", { name: /^Compare/ }),
    );
    expect(bindings.goCompare).toHaveBeenCalledTimes(1);
    expect(bindings.removeCompare).not.toHaveBeenCalled();
  });

  it("does not re-navigate when the active destination is selected", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      within(screen.getByTestId("therapy-detail-section-rail")).getByRole("button", { name: /^Overview/ }),
    );
    expect(bindings.open).not.toHaveBeenCalled();
  });

  it("pins Save in the header with a state that is never carried by colour alone", async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    const { unmount } = renderHeader(therapy, false, onToggleSave);

    const save = screen.getByTestId("therapy-detail-primary-action");
    expect(save).toHaveAttribute("aria-pressed", "false");
    expect(save).toHaveAccessibleName("Save");
    await user.click(save);
    expect(onToggleSave).toHaveBeenCalledTimes(1);

    unmount();
    renderHeader(therapy, true, onToggleSave);
    const saved = screen.getByTestId("therapy-detail-primary-action");
    expect(saved).toHaveAttribute("aria-pressed", "true");
    expect(saved).toHaveAccessibleName("Saved");
  });

  it("offers the record's secondary actions in the header sheet, and no review checklist", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByTestId("therapy-detail-actions-trigger"));
    const sheet = await screen.findByTestId("therapy-detail-actions-sheet");

    expect(within(sheet).getByRole("button", { name: /Print this record/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /All therapies/ })).toBeInTheDocument();
    // Removed on the owner's instruction: reviewing the record is a development
    // task, not something a clinician does mid-consultation.
    expect(within(sheet).queryByRole("button", { name: /Review checklist/ })).toBeNull();
    // Nothing offers to remove a therapy that is not in the comparison.
    expect(within(sheet).queryByRole("button", { name: /Remove from comparison/ })).toBeNull();
  });

  it("offers the comparison removal only while the therapy is in the comparison", async () => {
    bindings.inCompare = true;
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByTestId("therapy-detail-actions-trigger"));
    const sheet = await screen.findByTestId("therapy-detail-actions-sheet");
    await user.click(within(sheet).getByRole("button", { name: /Remove from comparison/ }));

    expect(bindings.removeCompare).toHaveBeenCalledWith(therapy.slug);
    await waitFor(() => expect(screen.queryByTestId("therapy-detail-actions-sheet")).toBeNull());
  });

  it("keeps the shared back-control contract", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Back to therapy search" })).toHaveAttribute(
      "href",
      "/therapy-compass/search",
    );
  });

  it("uses the unbadged four-slot calibration, not medication's counted one", () => {
    // These labels render without truncation from 500px and clip at 430px, so
    // they belong to the 31rem `balanced-four` family. Medication's counted
    // calibration would hold the same four back to 42rem, putting Brief and
    // Compare behind an extra tap on every phone and most tablets.
    renderHeader();
    const rail = screen.getByTestId("therapy-detail-section-rail");

    expect(rail.querySelector(".mode-nav")).toHaveAttribute("data-density-profile", "balanced-four");
    for (const [label, band] of [
      ["Overview", "3"],
      ["Info sheet", "3"],
      ["Brief", "4"],
      ["Compare", "4"],
    ] as const) {
      expect(
        within(rail)
          .getByRole("button", { name: new RegExp(`^${label}`) })
          .closest("li"),
        label,
      ).toHaveAttribute("data-band", band);
    }
    expect(screen.getByTestId("therapy-detail-section-overflow").closest("li")).toHaveAttribute("data-until", "3");
  });

  it("declares every destination exactly once", () => {
    expect(new Set(THERAPY_RECORD_DESTINATIONS).size).toBe(THERAPY_RECORD_DESTINATIONS.length);
  });
});
