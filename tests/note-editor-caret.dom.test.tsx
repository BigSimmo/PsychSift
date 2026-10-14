/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalNoteEditor } from "@/components/clinical-notes/note-editor";

describe("ClinicalNoteEditor (#TDKF8T)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    cleanup();
  });

  it("renders with initial value and idle status", () => {
    render(<ClinicalNoteEditor initialValue="Initial psychiatric assessment notes." />);

    const textarea = screen.getByTestId("note-editor-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial psychiatric assessment notes.");
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
});
