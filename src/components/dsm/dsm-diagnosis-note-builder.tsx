"use client";

import { MessageSquareText, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";

import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, fieldControlPlain, fieldLabel } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { buildDsmDiagnosisNote, type DsmCriterionStatus, type DsmNoteBuilderRecord } from "@/lib/dsm-note";

/**
 * Replaces the `documentation_template` paragraph this section used to render.
 *
 * That paragraph was a single fixed string per record which asserted every
 * criterion as met and enumerated every symptom the disorder can present with —
 * for panic disorder, all thirteen. Pasting it documented findings that may
 * never have been elicited, and it could not be edited, tailored or even copied
 * from the page. Everything this builder emits comes from what the clinician
 * ticked, and a criterion left alone is reported as not assessed rather than
 * quietly dropped, so the note cannot claim more than the assessment supports.
 */

const STATUS_OPTIONS: ReadonlyArray<{ value: DsmCriterionStatus; label: string }> = [
  { value: "met", label: "Met" },
  { value: "not-met", label: "Not met" },
  { value: "not-assessed", label: "Not assessed" },
];

const COPY_RESET_MS = 2200;

export function DsmDiagnosisNoteBuilder({ record }: { record: DsmNoteBuilderRecord }) {
  const { criteria, differentials, specifiers: selectableSpecifiers, isDsmCriteria } = record;
  // On 145 of the 146 records these rows are the key-feature summary, not DSM-5-TR
  // criteria. The controls say which one the clinician is actually ticking, so the
  // wording on screen matches the wording the note will carry.
  const rowNoun = isDsmCriteria ? "criterion" : "key feature";

  const initialDraft = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const draft = sessionStorage.getItem(`psychsift_dsm_draft_${record.icdCode}`);
      return draft ? JSON.parse(draft) : null;
    } catch {
      return null;
    }
  }, [record.icdCode]);

  const [statuses, setStatuses] = useState<Record<string, DsmCriterionStatus>>(() => initialDraft?.statuses ?? {});
  const [specifiers, setSpecifiers] = useState<string[]>(() => initialDraft?.specifiers ?? []);
  const [specifierText, setSpecifierText] = useState(() => initialDraft?.specifierText ?? "");
  const [excluded, setExcluded] = useState<string[]>(() => initialDraft?.excluded ?? []);
  const [includeCriterionText, setIncludeCriterionText] = useState(() => initialDraft?.includeCriterionText ?? true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<number | null>(null);

  const criterionKey = (label: string, index: number) => label || String(index + 1);

  const isDirty =
    Object.keys(statuses).length > 0 || specifiers.length > 0 || specifierText.trim().length > 0 || excluded.length > 0;
  useDirtyStateGuard(isDirty);

  useEffect(() => {
    if (isDirty || !includeCriterionText) {
      sessionStorage.setItem(
        `psychsift_dsm_draft_${record.icdCode}`,
        JSON.stringify({ statuses, specifiers, specifierText, excluded, includeCriterionText }),
      );
    }
  }, [record.icdCode, isDirty, statuses, specifiers, specifierText, excluded, includeCriterionText]);

  const note = useMemo(
    () =>
      buildDsmDiagnosisNote({
        title: record.title,
        icdCode: record.icdCode,
        isDsmCriteria: record.isDsmCriteria,
        criteria: criteria.map((criterion, index) => ({
          label: criterionKey(criterion.label, index),
          text: criterion.text,
          status: statuses[criterionKey(criterion.label, index)] ?? "not-assessed",
        })),
        specifiers,
        specifierText,
        excludedDifferentials: excluded,
        includeCriterionText,
      }),
    [criteria, record, statuses, specifiers, specifierText, excluded, includeCriterionText],
  );

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  const storageKey = `psychsift:draft:dsm-note:${record.icdCode || record.title}`;

  const isDirty = useMemo(
    () =>
      Object.keys(statuses).length > 0 ||
      specifiers.length > 0 ||
      specifierText.trim().length > 0 ||
      excluded.length > 0,
    [statuses, specifiers, specifierText, excluded],
  );

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      queueMicrotask(() => {
        if (parsed.statuses) setStatuses(parsed.statuses);
        if (Array.isArray(parsed.specifiers)) setSpecifiers(parsed.specifiers);
        if (typeof parsed.specifierText === "string") setSpecifierText(parsed.specifierText);
        if (Array.isArray(parsed.excluded)) setExcluded(parsed.excluded);
        if (typeof parsed.includeCriterionText === "boolean") setIncludeCriterionText(parsed.includeCriterionText);
      });
    } catch {
      // Ignore corrupted session storage
    }
  }, [storageKey]);

  // Prevent accidental navigation when form is dirty
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Persist draft to sessionStorage on state changes
  useEffect(() => {
    try {
      if (isDirty) {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            statuses,
            specifiers,
            specifierText,
            excluded,
            includeCriterionText,
          }),
        );
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore quota errors
    }
  }, [isDirty, storageKey, statuses, specifiers, specifierText, excluded, includeCriterionText]);

  function resetBuilder() {
    setStatuses({});
    setSpecifiers([]);
    setSpecifierText("");
    setExcluded([]);
    setIncludeCriterionText(true);
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }

  async function copyNote() {
    try {
      await copyTextToClipboard(note);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), COPY_RESET_MS);
  }

  const assessedCount = criteria.filter(
    (criterion, index) => (statuses[criterionKey(criterion.label, index)] ?? "not-assessed") !== "not-assessed",
  ).length;

  return (
    <section
      id="documentation"
      aria-labelledby="documentation-title"
      data-testid="dsm-note-builder"
      className={cn(
        inPageAnchor,
        "rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]",
      )}
    >
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-[color:var(--clinical-accent)]" aria-hidden />
        <h2 id="documentation-title" className="text-base font-extrabold text-[color:var(--text-heading)]">
          Documentation support
        </h2>
        <span className="ml-auto text-xs font-bold text-[color:var(--text-muted)]">
          {assessedCount} of {criteria.length} recorded
        </span>
      </div>
      <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
        Record each {rowNoun} against your assessment. The note is built from what you mark, and anything you leave
        alone is written out as not assessed.
        {isDsmCriteria
          ? null
          : " This record does not include the full DSM-5-TR criteria, so the note states that it was built from a key feature summary."}
      </p>

      <fieldset className="mt-3 grid gap-1.5">
        <legend className="sr-only">{isDsmCriteria ? "Criteria assessment" : "Key feature assessment"}</legend>
        {criteria.map((criterion, index) => {
          const key = criterionKey(criterion.label, index);
          const status = statuses[key] ?? "not-assessed";
          return (
            <div
              key={key}
              className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-3"
            >
              <p className="min-w-0 text-sm font-medium leading-6 text-[color:var(--text-heading)]">
                <strong className="mr-1.5 text-[color:var(--clinical-accent)]">{key}.</strong>
                {criterion.text}
              </p>
              <SegmentedControl
                label={`${isDsmCriteria ? "Criterion" : "Key feature"} ${key}`}
                value={status}
                onChange={(next) => setStatuses((current) => ({ ...current, [key]: next }))}
                options={STATUS_OPTIONS}
                layout="equal"
              />
            </div>
          );
        })}
      </fieldset>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">Specifiers</h3>
          {selectableSpecifiers.length > 0 ? (
            <div className="mt-1.5 grid gap-0.5">
              {selectableSpecifiers.map((specifier) => (
                <Checkbox
                  key={specifier.name}
                  label={specifier.name}
                  checked={specifiers.includes(specifier.name)}
                  onChange={() => setSpecifiers((current) => toggle(current, specifier.name))}
                />
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
              No single-value specifiers in this record. Type any that apply below.
            </p>
          )}
          <label className={cn(fieldLabel, "mt-3")} htmlFor="dsm-note-specifier-text">
            Other specifiers, comma separated
          </label>
          <input
            id="dsm-note-specifier-text"
            type="text"
            value={specifierText}
            onChange={(event) => setSpecifierText(event.target.value)}
            placeholder="moderate, recurrent"
            className={fieldControlPlain}
          />
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">Differentials excluded</h3>
          <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
            Tick only those you actively considered and ruled out.
          </p>
          <div className="mt-1.5 grid gap-0.5">
            {differentials.map((differential) => (
              <Checkbox
                key={differential}
                label={differential}
                checked={excluded.includes(differential)}
                onChange={() => setExcluded((current) => toggle(current, differential))}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-[color:var(--border)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">Note</h3>
          <div className="ml-auto">
            <Checkbox
              label={`Include ${rowNoun} wording`}
              checked={includeCriterionText}
              onChange={(event) => setIncludeCriterionText(event.target.checked)}
            />
          </div>
        </div>
        {note ? (
          <>
            <pre
              data-testid="dsm-note-output"
              className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border-l-[3px] border-l-[color:var(--clinical-accent)] bg-[color:var(--surface-subtle)] px-3 py-3 font-sans text-sm font-medium leading-6 text-[color:var(--text-heading)] sm:px-4"
            >
              {note}
            </pre>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyButton
                label="Copy note"
                copied={copyState === "copied"}
                onClick={() => void copyNote()}
                testId="dsm-note-copy"
              />
              <Button type="button" variant="secondary" onClick={resetBuilder} icon={RotateCcw}>
                Start over
              </Button>
            </div>
            <p role="status" className="sr-only">
              {copyState === "copied"
                ? "Note copied to the clipboard."
                : copyState === "failed"
                  ? "Copying failed. Select the note text and copy it manually."
                  : ""}
            </p>
          </>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-[color:var(--border)] px-3 py-4 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
            Mark at least one {rowNoun} to build the note.
          </p>
        )}
        <p className="mt-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
          Plain characters only, so the text pastes cleanly into a record. This is a documentation aid and not a
          substitute for diagnostic reasoning or local documentation requirements.
        </p>
      </div>
    </section>
  );
}
