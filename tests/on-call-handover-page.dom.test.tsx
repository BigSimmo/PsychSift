// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallHandoverPage } from "@/components/on-call/handover/handover-page";
import { addOnCallCallLogEntry } from "@/lib/on-call/call-log";
import { ON_CALL_HANDOVER_NOT_SET_UP, onCallHandoverStorageKey } from "@/lib/on-call/handover";

vi.mock("@/components/on-call/on-call-nav-header", () => ({ OnCallToolNavHeader: () => null }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function addPatient(bed: string, ward: string, review: "yes" | "no") {
  fill("on-call-handover-bed", bed);
  if (ward) fill("on-call-handover-ward", ward);
  fill("on-call-handover-impression", "Example impression");
  fireEvent.click(screen.getByTestId(`on-call-handover-review-${review}`));
}

describe("handover page (mock-up v10, screens 6 to 10)", () => {
  it("shows the privacy band and has no name or record-number field", () => {
    render(<OnCallHandoverPage />);
    const band = screen.getByTestId("on-call-handover-privacy");
    expect(band).toHaveTextContent("Private to this phone");
    expect(band).toHaveTextContent("Not synced");
    expect(band).toHaveTextContent("Not searched");
    expect(band).toHaveTextContent("No AI");
    expect(band).toHaveTextContent("Anyone who can unlock this phone can read it until then.");
    const form = screen.getByTestId("on-call-handover-form");
    expect(within(form).queryByText(/^Name$/)).toBeNull();
    expect(within(form).queryByText(/UMRN/)).toBeNull();
    expect(screen.getByLabelText("Bed or initials")).toBeInTheDocument();
  });

  it("shows no form for a type whose fields are not agreed, only an honest note", () => {
    render(<OnCallHandoverPage />);
    fireEvent.click(screen.getByTestId("on-call-handover-type-general-medicine"));
    expect(screen.getByTestId("on-call-handover-type-not-set-up")).toHaveTextContent(ON_CALL_HANDOVER_NOT_SET_UP);
    expect(screen.queryByTestId("on-call-handover-form")).toBeNull();
    fireEvent.click(screen.getByTestId("on-call-handover-type-psychiatry"));
    expect(screen.getByTestId("on-call-handover-form")).toBeInTheDocument();
  });

  it("refuses a name in the bed field", () => {
    render(<OnCallHandoverPage />);
    fill("on-call-handover-bed", "Jane Smith");
    expect(screen.getByTestId("on-call-handover-problem")).toHaveTextContent("not a name");
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });

  it("copies the ward from the last patient and says so", () => {
    render(<OnCallHandoverPage />);
    addPatient("12", "Example Ward", "yes");
    fireEvent.click(screen.getByTestId("on-call-handover-next"));
    expect(screen.getByTestId("on-call-handover-ward")).toHaveValue("Example Ward");
    expect(screen.getByText("Ward copied from last")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-handover-position")).toHaveTextContent("Patient 2 of 2");
  });

  it("takes any legal status as typed, so the register is a help and never the only choice", () => {
    render(<OnCallHandoverPage />);
    fill("on-call-handover-bed", "9");
    fireEvent.click(screen.getByTestId("on-call-handover-legal"));
    const sheet = screen.getByTestId("on-call-handover-legal-sheet");
    fireEvent.change(within(sheet).getByTestId("on-call-handover-legal-search"), {
      target: { value: "Awaiting review" },
    });
    fireEvent.click(within(sheet).getByTestId("on-call-handover-legal-typed-option"));
    expect(screen.queryByTestId("on-call-handover-legal-sheet")).toBeNull();
    expect(screen.getByTestId("on-call-handover-legal")).toHaveTextContent("Awaiting review");
  });

  it("picks a legal status from the register in one tap and offers it again as recent", () => {
    render(<OnCallHandoverPage />);
    fill("on-call-handover-bed", "9");
    fireEvent.click(screen.getByTestId("on-call-handover-legal"));
    const sheet = screen.getByTestId("on-call-handover-legal-sheet");
    expect(sheet).toHaveTextContent("Codes and titles from the app's official forms register");
    // "Voluntary" is offered as a plain status; "Not under the Act" never is.
    expect(within(sheet).getByText("Voluntary")).toBeInTheDocument();
    expect(within(sheet).queryByText("Not under the Act")).toBeNull();
    fireEvent.change(within(sheet).getByTestId("on-call-handover-legal-search"), { target: { value: "6A" } });
    fireEvent.click(within(sheet).getAllByTestId("on-call-handover-legal-option")[0]!);
    expect(screen.queryByTestId("on-call-handover-legal-sheet")).toBeNull();
    expect(screen.getByTestId("on-call-handover-legal")).toHaveTextContent(
      "Inpatient treatment order in authorised hospital",
    );
    expect(within(screen.getByTestId("on-call-handover-legal-recent")).getByText("6A")).toBeInTheDocument();
  });

  it("offers an open call-log to-do that is not in the handover, then stops offering it once added", () => {
    const noted = addOnCallCallLogEntry({ label: "4B-12", caller: "Ward", note: "Agitated", followUp: "Review" });
    expect(noted.ok).toBe(true);
    render(<OnCallHandoverPage />);
    expect(screen.getByTestId("on-call-handover-calls")).toHaveTextContent(
      "1 to-do in tonight's call log is not in this handover",
    );
    fireEvent.click(screen.getByTestId("on-call-handover-add-call"));
    expect(screen.queryByTestId("on-call-handover-calls")).toBeNull();
    expect(screen.getByTestId("on-call-handover-bed")).toHaveValue("4B-12");
  });

  it("makes the table and checks where it is going before any export, counting beds only", () => {
    render(<OnCallHandoverPage />);
    addPatient("12", "Example Ward", "yes");
    fireEvent.click(screen.getByTestId("on-call-handover-next"));
    addPatient("JS", "", "no");
    fireEvent.click(screen.getByTestId("on-call-handover-make-table"));
    expect(screen.getByRole("heading", { name: "Handover table" })).toBeInTheDocument();
    expect(screen.getAllByTestId("on-call-handover-table-row")).toHaveLength(2);
    expect(screen.getByTestId("on-call-handover-review-bar")).toHaveTextContent("1 of 2 need review");
    fireEvent.click(screen.getByTestId("on-call-handover-table-copy"));
    const check = screen.getByTestId("on-call-handover-before-it-leaves");
    expect(check).toHaveTextContent("This handover lists 2 patients");
    expect(check).toHaveTextContent("Check the free text for names or record numbers · 1 for review");
    expect(check).toHaveTextContent("PsychSift sends nothing to its servers or to AI");
    expect(check).toHaveTextContent("Once pasted or shared, that place's rules apply");
    expect(check).toHaveTextContent(/Your draft still clears at \d\d:\d\d/);
    // It asks the reader to check the free text, and never claims a count of names.
    expect(check).not.toHaveTextContent(/\d+ names?|UMRN/);
    // Share is off until the owner decides (and jsdom has no navigator.share).
    expect(within(check).queryByTestId("on-call-handover-leave-share")).toBeNull();
    expect(screen.getByTestId("on-call-handover-leave-confirm")).toHaveTextContent("Copy table");
    fireEvent.click(within(check).getByTestId("on-call-handover-leave-print"));
    expect(screen.getByTestId("on-call-handover-leave-confirm")).toHaveTextContent("Print");
    fireEvent.click(screen.getByTestId("on-call-handover-leave-cancel"));
    expect(screen.queryByTestId("on-call-handover-before-it-leaves")).toBeNull();
  });

  it("clears the whole handover only after a named confirmation", () => {
    render(<OnCallHandoverPage />);
    addPatient("12", "Example Ward", "no");
    fireEvent.click(screen.getByTestId("on-call-handover-clear"));
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).not.toBeNull();
    fireEvent.click(screen.getByTestId("on-call-handover-clear-confirm"));
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });
});
