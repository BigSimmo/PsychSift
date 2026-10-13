"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";

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
  placeholder = "Enter clinical note...",
  className = "",
  label = "Clinical Note",
}: NoteEditorProps) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(initialValue);
  const currentValue = isControlled ? controlledValue : internalValue;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedValue, setLastSavedValue] = useState(currentValue);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      if (readOnly || textToSave === lastSavedValue) return;

      // Capture caret position before triggering save
      recordSelection();
      setSaveStatus("saving");

      try {
        if (onSave) {
          await onSave(textToSave);
        }
        setLastSavedValue(textToSave);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [readOnly, lastSavedValue, onSave, recordSelection],
  );

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    recordSelection();

    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
    setSaveStatus("unsaved");

    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Schedule debounced auto-save
    saveTimerRef.current = setTimeout(() => {
      performSave(newValue);
    }, debounceMs);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    recordSelection();
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    recordSelection();
    // Save on blur if unsaved
    if (saveStatus === "unsaved") {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      performSave(currentValue);
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
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={`clinical-note-editor flex flex-col gap-2 ${className}`} data-testid="clinical-note-editor">
      <div className="flex justify-between items-center text-xs">
        <label htmlFor="clinical-note-textarea" className="font-semibold text-gray-700">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs px-2 py-0.5 rounded ${
              saveStatus === "saving"
                ? "bg-amber-100 text-amber-800"
                : saveStatus === "saved"
                  ? "bg-green-100 text-green-800"
                  : saveStatus === "error"
                    ? "bg-red-100 text-red-800"
                    : "text-gray-500"
            }`}
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
          <button
            type="button"
            onClick={() => performSave(currentValue)}
            disabled={readOnly || saveStatus === "saving" || saveStatus === "saved"}
            className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="note-editor-save-btn"
          >
            Save now
          </button>
        </div>
      </div>

      <textarea
        id="clinical-note-textarea"
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
        className="w-full min-h-[160px] p-3 text-sm font-sans border rounded-md border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white resize-y"
        data-testid="note-editor-textarea"
        spellCheck={false}
      />
    </div>
  );
}
