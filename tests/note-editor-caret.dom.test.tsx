/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalNoteEditor } from "@/components/clinical-notes/note-editor";
import { ACCOUNT_TRANSITION_EVENT } from "@/lib/account-scoped-browser-state";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import { PATIENT_LABELS_CLEARED_EVENT } from "@/lib/patient-label-storage";

describe("ClinicalNoteEditor (#TDKF8T)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSharedDevice(false);
  });

  afterEach(() => {
    setSharedDevice(false);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    cleanup();
  });

  it("renders with initial value, idle status, de-identified placeholder, and privacy attributes", () => {
    render(<ClinicalNoteEditor initialValue="Initial psychiatric assessment notes." />);

    const textarea = screen.getByTestId("note-editor-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial psychiatric assessment notes.");
    expect(textarea.placeholder).toContain("de-identified");
    expect(textarea).toHaveAttribute("autocomplete", "off");
    expect(textarea).toHaveAttribute("autocorrect", "off");
    expect(textarea).toHaveAttribute("spellcheck", "false");
    expect(textarea).toHaveAttribute("data-gramm", "false");
    expect(textarea).toHaveAttribute("data-enable-grammarly", "false");
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Idle");
  });

  it("preserves caret position across debounced auto-save", async () => {
    const onSave = vi.fn().mockImplementation(() => Promise.resolve());

    render(
      <ClinicalNoteEditor
        initialValue="Patient presents with acute anxiety symptoms."
        onSave={onSave}
        debounceMs={500}
      />,
    );

    const textarea = screen.getByTestId("note-editor-textarea") as HTMLTextAreaElement;
    textarea.focus();

    // Place caret in the middle of the text (e.g. at index 15)
    textarea.setSelectionRange(15, 15);
    expect(textarea.selectionStart).toBe(15);
    expect(textarea.selectionEnd).toBe(15);

    // Type a character inside the middle
    fireEvent.change(textarea, {
      target: { value: "Patient presents today with acute anxiety symptoms." },
    });

    // Set caret at index 22
    textarea.setSelectionRange(22, 22);
    expect(textarea.selectionStart).toBe(22);

    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Unsaved changes");

    // Advance timer past debounce threshold
    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    // Verify onSave was called
    expect(onSave).toHaveBeenCalledWith("Patient presents today with acute anxiety symptoms.");
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Saved");

    // Caret MUST still be at index 22, not reset to 0 or end of document
    expect(textarea.selectionStart).toBe(22);
    expect(textarea.selectionEnd).toBe(22);
  });

  it("preserves range selection across auto-save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ClinicalNoteEditor
        initialValue="Mental state examination: alert, oriented x 3."
        onSave={onSave}
        debounceMs={300}
      />,
    );

    const textarea = screen.getByTestId("note-editor-textarea") as HTMLTextAreaElement;
    textarea.focus();

    // Select "alert, oriented" (indices 26 to 41)
    textarea.setSelectionRange(26, 41);
    fireEvent.select(textarea);

    expect(textarea.selectionStart).toBe(26);
    expect(textarea.selectionEnd).toBe(41);

    // Trigger save via blur or timer
    fireEvent.blur(textarea);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    // Refocus
    textarea.focus();

    // Caret / selection range is preserved
    expect(textarea.selectionStart).toBe(26);
    expect(textarea.selectionEnd).toBe(41);
  });

  it("manual Save now button triggers save immediately", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<ClinicalNoteEditor initialValue="Initial draft" onSave={onSave} />);

    const textarea = screen.getByTestId("note-editor-textarea");
    fireEvent.change(textarea, { target: { value: "Updated clinical draft" } });

    const saveBtn = screen.getByTestId("note-editor-save-btn");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSave).toHaveBeenCalledWith("Updated clinical draft");
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Saved");
  });

  it("suppresses background auto-save on shared clinical devices while allowing manual save", async () => {
    setSharedDevice(true);
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<ClinicalNoteEditor initialValue="Initial draft" onSave={onSave} debounceMs={300} />);

    expect(screen.getByTestId("note-editor-shared-device-notice")).toBeInTheDocument();

    const textarea = screen.getByTestId("note-editor-textarea");
    fireEvent.change(textarea, { target: { value: "Shared workstation draft" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Unsaved changes");

    // Manual Save now still works
    await act(async () => {
      fireEvent.click(screen.getByTestId("note-editor-save-btn"));
    });
    expect(onSave).toHaveBeenCalledWith("Shared workstation draft");
  });

  it("wipes internal draft state and cancels pending timers on account transition and patient-label clear", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<ClinicalNoteEditor initialValue="Sensitive shift note" onSave={onSave} debounceMs={400} />);

    const textarea = screen.getByTestId("note-editor-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated sensitive shift note" } });
    expect(textarea.value).toBe("Updated sensitive shift note");

    act(() => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_TRANSITION_EVENT));
    });

    expect(textarea.value).toBe("");
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Idle");

    fireEvent.change(textarea, { target: { value: "Second shift note before Clear all" } });
    expect(textarea.value).toBe("Second shift note before Clear all");

    act(() => {
      window.dispatchEvent(new CustomEvent(PATIENT_LABELS_CLEARED_EVENT));
    });

    expect(textarea.value).toBe("");
    expect(screen.getByTestId("note-editor-status")).toHaveTextContent("Idle");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});
