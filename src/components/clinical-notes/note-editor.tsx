"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn, toneDanger, toneSuccess, toneWarning } from "@/components/ui-primitives";
import { ACCOUNT_TRANSITION_EVENT } from "@/lib/account-scoped-browser-state";
import { useSharedDevice } from "@/lib/alerts/shared-device";
import { PATIENT_LABELS_CLEARED_EVENT } from "@/lib/patient-label-storage";
import { checkPatientDetail, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface NoteEditorProps {
  initialValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => Promise<void> | void;
  debounceMs?: number;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  label?: string;
}

/**
 * Clinical Note Editor with debounced auto-save and caret preservation (#TDKF8T).
 *
 * Automatically saves clinical note drafts while actively preserving the user's
 * cursor/caret position across debounced background saves and state updates.
 */
export function ClinicalNoteEditor({
  initialValue = "",
  value: controlledValue,
  onChange,
  onSave,
  debounceMs = 1000,
  readOnly = false,
  placeholder = "Write de-identified clinical note (no patient name, DOB, or MRN)...",
  className = "",
  label = "Clinical Note",
}: NoteEditorProps) {
  const instanceId = useId();
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(controlledValue ?? initialValue);
  const [privacyProblem, setPrivacyProblem] = useState<PatientDetailProblem | null>(() =>
    checkPatientDetail(controlledValue ?? initialValue),
  );
  const currentValue = internalValue;
  const sharedDevice = useSharedDevice();

  // Keep controlled updates as the source of truth when the parent changes them,
  // but do not switch away from the locally typed value while it is being checked.
  // Adjusted during render (not in an effect) so the new value shows in the same pass.
  const [syncedControlledValue, setSyncedControlledValue] = useState(controlledValue);
  if (isControlled && controlledValue !== syncedControlledValue) {
    setSyncedControlledValue(controlledValue);
    setInternalValue(controlledValue);
    setPrivacyProblem(checkPatientDetail(controlledValue));
  }

  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() =>
    checkPatientDetail(controlledValue ?? initialValue) ? "error" : "idle",
  );
  const [lastSavedValue, setLastSavedValue] = useState(controlledValue ?? initialValue);
  const hasSavedRef = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestValueRef = useRef(currentValue);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    latestValueRef.current = currentValue;
  }, [currentValue]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Store selection state to restore across re-renders/saves
  const selectionRef = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  }>({
    start: currentValue.length,
    end: currentValue.length,
    direction: "none",
  });

  // Track if editor currently has focus
  const isFocusedRef = useRef(false);

  // Record current selection whenever cursor moves or text changes
  const recordSelection = useCallback(() => {
    if (textareaRef.current) {
      selectionRef.current = {
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
        direction: textareaRef.current.selectionDirection || "none",
      };
    }
  }, []);

  // Restore caret position if focused
  const restoreSelection = useCallback(() => {
    if (textareaRef.current && isFocusedRef.current) {
      const { start, end, direction } = selectionRef.current;
      const textLen = textareaRef.current.value.length;
      const clampedStart = Math.min(start, textLen);
      const clampedEnd = Math.min(end, textLen);
      try {
        textareaRef.current.setSelectionRange(clampedStart, clampedEnd, direction);
      } catch {
        // Safe fallback in restricted environments
      }
    }
  }, []);

  // Ensure selection is preserved after render updates
  useLayoutEffect(() => {
    restoreSelection();
  }, [currentValue, saveStatus, restoreSelection]);

  const performSave = useCallback(
    async (textToSave: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (readOnly) return;
      const problem = checkPatientDetail(textToSave);
      if (problem !== null) {
        setPrivacyProblem(problem);
        setSaveStatus("error");
        return;
      }
      setPrivacyProblem(null);
      if (!onSave) {
        setSaveStatus("idle");
        return;
      }
      if (textToSave === lastSavedValue && saveStatus !== "error") {
        if (saveStatus === "unsaved") {
          setSaveStatus(hasSavedRef.current ? "saved" : "idle");
        }
        return;
      }

      // Capture caret position before triggering save
      recordSelection();
      setSaveStatus("saving");

      try {
        await onSave(textToSave);
        hasSavedRef.current = true;
        setLastSavedValue(textToSave);
        if (latestValueRef.current === textToSave) {
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("error");
      }
    },
    [readOnly, lastSavedValue, saveStatus, onSave, recordSelection],
  );

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    recordSelection();
    setInternalValue(newValue);

    const problem = checkPatientDetail(newValue);
    setPrivacyProblem(problem);
    if (problem !== null) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setSaveStatus("error");
      return;
    }

    onChange?.(newValue);

    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!onSave) {
      setSaveStatus("idle");
      return;
    }

    if (newValue === lastSavedValue) {
      setSaveStatus(hasSavedRef.current ? "saved" : "idle");
      return;
    }

    setSaveStatus("unsaved");

    // Suppress background auto-save on shared clinical devices
    if (sharedDevice) {
      return;
    }

    // Schedule debounced auto-save
    saveTimerRef.current = setTimeout(() => {
      void performSave(newValue);
    }, debounceMs);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    recordSelection();
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    recordSelection();
    // Save on blur if unsaved and not on a shared device
    if (onSave && saveStatus === "unsaved" && !sharedDevice && privacyProblem === null) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void performSave(currentValue);
    }
  };

  const handleSelect = () => {
    recordSelection();
  };

  const handleKeyDown = () => {
    recordSelection();
  };

  const handleKeyUp = () => {
    recordSelection();
  };

  useEffect(() => {
    const clearEditorState = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      selectionRef.current = { start: 0, end: 0, direction: "none" };
      hasSavedRef.current = false;
      setInternalValue("");
      setLastSavedValue("");
      setPrivacyProblem(null);
      setSaveStatus("idle");
      onChangeRef.current?.("");
    };

    if (typeof window !== "undefined") {
      window.addEventListener(ACCOUNT_TRANSITION_EVENT, clearEditorState);
      window.addEventListener("account-scoped-browser-storage-clear", clearEditorState);
      window.addEventListener(PATIENT_LABELS_CLEARED_EVENT, clearEditorState);
    }

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener(ACCOUNT_TRANSITION_EVENT, clearEditorState);
        window.removeEventListener("account-scoped-browser-storage-clear", clearEditorState);
        window.removeEventListener(PATIENT_LABELS_CLEARED_EVENT, clearEditorState);
      }
    };
  }, []);

  const showSaveControls = Boolean(onSave) || privacyProblem !== null || saveStatus === "error";
  const describedBy =
    [showSaveControls ? `${instanceId}-status` : null, privacyProblem ? `${instanceId}-privacy-warning` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("clinical-note-editor flex flex-col gap-2", className)} data-testid="clinical-note-editor">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={`${instanceId}-textarea`} className="font-semibold text-[color:var(--text)]">
          {label}
        </label>
        {showSaveControls ? (
          <div className="flex items-center gap-2">
            <span
              id={`${instanceId}-status`}
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-xs",
                saveStatus === "saving"
                  ? toneWarning
                  : saveStatus === "saved"
                    ? toneSuccess
                    : saveStatus === "error"
                      ? toneDanger
                      : "border-transparent text-[color:var(--text-muted)]",
              )}
              data-testid="note-editor-status"
            >
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved"
                  : saveStatus === "error"
                    ? "Save error"
                    : saveStatus === "unsaved"
                      ? "Unsaved changes"
                      : "Idle"}
            </span>
            {onSave ? (
              <button
                type="button"
                onClick={() => void performSave(currentValue)}
                disabled={
                  readOnly ||
                  privacyProblem !== null ||
                  saveStatus === "saving" ||
                  (currentValue === lastSavedValue && saveStatus !== "error")
                }
                className={buttonFaceClass({ variant: "secondary", size: "sm" })}
                data-testid="note-editor-save-btn"
              >
                Save now
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {sharedDevice ? (
        <p className="text-xs text-[color:var(--text-muted)]" data-testid="note-editor-shared-device-notice">
          Shared device mode: background auto-save is paused. Use Save now to save intentionally.
        </p>
      ) : null}

      {privacyProblem ? (
        <div
          id={`${instanceId}-privacy-warning`}
          role="alert"
          className={cn("rounded-lg border p-3 text-xs", toneDanger)}
          data-testid="note-editor-privacy-warning"
        >
          <p className="font-semibold">{privacyProblem.title}</p>
          <p>{privacyProblem.body}</p>
          {privacyProblem.suggestion ? <p className="mt-1">{privacyProblem.suggestion}</p> : null}
        </div>
      ) : null}

      <textarea
        id={`${instanceId}-textarea`}
        aria-describedby={describedBy}
        ref={textareaRef}
        value={currentValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={recordSelection}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn(
          "min-h-40 w-full resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 font-sans text-sm text-[color:var(--text)]",
          focusRing,
        )}
        data-testid="note-editor-textarea"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-gramm="false"
        data-enable-grammarly="false"
      />
    </div>
  );
}
