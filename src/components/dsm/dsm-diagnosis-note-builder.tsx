"use client";

import { MessageSquareText, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";

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

const criterionKey = (label: string, index: number) => label || String(index + 1);

const subscribeNothing = () => () => undefined;
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

type DsmNoteDraft = {
  statuses: Record<string, DsmCriterionStatus>;
  specifiers: string[];
  specifierText: string;
  excluded: string[];
  includeCriterionText: boolean;
};

/**
 * Keyed by slug, not ICD code: before the 26 Oct 2026 code corrections F65.81 and G24.09
 * each covered two records, and an ICD-keyed draft restored one diagnosis's answers onto
 * the other.
 */
function dsmNoteDraftStorageKey(slug: string) {
  return `psychsift_dsm_draft_${slug}`;
}

/**
 * Drafts saved before the slug key were keyed by ICD code. One whose code has only ever
 * belonged to this record is read once and moved to the slug key, so a draft open across a
 * deploy is not lost. These codes are never read, because their legacy draft may belong to
 * another diagnosis: F65.81 and G24.09 were shared by two records, and the 26 Oct 2026
 * corrections moved F94.1, F94.2, G24.01 and G25.71 from one record to another.
 * tests/dsm-diagnosis-note-builder.dom.test.tsx checks this set against the catalogue.
 */
export const DSM_UNSAFE_LEGACY_DRAFT_CODES: ReadonlySet<string> = new Set([
  "F65.81",
  "G24.09",
  "F94.1",
  "F94.2",
  "G24.01",
  "G25.71",
]);

function legacyDsmNoteDraftStorageKey(record: DsmNoteBuilderRecord): string | null {
  return DSM_UNSAFE_LEGACY_DRAFT_CODES.has(record.icdCode) ? null : `psychsift_dsm_draft_${record.icdCode}`;
}

function readDsmNoteDraftWithLegacy(storageKey: string, record: DsmNoteBuilderRecord): DsmNoteDraft | null {
  const current = readDsmNoteDraft(storageKey, record);
  if (current) return current;
  const legacyKey = legacyDsmNoteDraftStorageKey(record);
  if (!legacyKey) return null;
  const legacy = readDsmNoteDraft(legacyKey, record);
  if (!legacy) return null;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(legacy));
    sessionStorage.removeItem(legacyKey);
  } catch {
    // Storage refused the move; the draft still restores for this visit.
  }
  return legacy;
}

const STATUS_VALUES = new Set<string>(STATUS_OPTIONS.map((option) => option.value));

/**
 * Reads a saved draft and keeps only the answers this record can show, so nothing
 * the clinician cannot see on this page reaches the copied note.
 */
function readDsmNoteDraft(storageKey: string, record: DsmNoteBuilderRecord): DsmNoteDraft | null {
  let parsed: Partial<Record<keyof DsmNoteDraft, unknown>> | null;
  try {
    const draft = sessionStorage.getItem(storageKey);
    parsed = draft ? JSON.parse(draft) : null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const criterionKeys = new Set(record.criteria.map((criterion, index) => criterionKey(criterion.label, index)));
  const allowedIn = (value: unknown, allowed: ReadonlySet<string>) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && allowed.has(entry))
      : [];
  const savedStatuses = parsed.statuses && typeof parsed.statuses === "object" ? parsed.statuses : {};

  return {
    statuses: Object.fromEntries(
      Object.entries(savedStatuses).filter(
        (entry): entry is [string, DsmCriterionStatus] =>
          criterionKeys.has(entry[0]) && typeof entry[1] === "string" && STATUS_VALUES.has(entry[1]),
      ),
    ),
    specifiers: allowedIn(parsed.specifiers, new Set(record.specifiers.map((specifier) => specifier.name))),
    specifierText: typeof parsed.specifierText === "string" ? parsed.specifierText : "",
    excluded: allowedIn(parsed.excluded, new Set(record.differentials)),
    includeCriterionText: typeof parsed.includeCriterionText === "boolean" ? parsed.includeCriterionText : true,
  };
}

export function DsmDiagnosisNoteBuilder({ record }: { record: DsmNoteBuilderRecord }) {
  // The server cannot see sessionStorage, so its HTML is always the empty builder.
  // Reading the draft only after hydration, in a fresh mount, keeps the client's
  // first render identical to that HTML.
  const hydrated = useHydrated();
  return (
    <DsmDiagnosisNoteBuilderInner
      key={`${record.slug}:${hydrated ? "client" : "server"}`}
      record={record}
      restoreDraft={hydrated}
    />
  );
}

function DsmDiagnosisNoteBuilderInner({
  record,
  restoreDraft,
}: {
  record: DsmNoteBuilderRecord;
  restoreDraft: boolean;
}) {
  const { criteria, differentials, specifiers: selectableSpecifiers, isDsmCriteria } = record;
  // On 145 of the 146 records these rows are the key-feature summary, not DSM-5-TR
  // criteria. The controls say which one the clinician is actually ticking, so the
  // wording on screen matches the wording the note will carry.
  const rowNoun = isDsmCriteria ? "criterion" : "key feature";
  const storageKey = dsmNoteDraftStorageKey(record.slug);

  const [initialDraft] = useState(() => (restoreDraft ? readDsmNoteDraftWithLegacy(storageKey, record) : null));

  const [statuses, setStatuses] = useState<Record<string, DsmCriterionStatus>>(() => initialDraft?.statuses ?? {});
  const [specifiers, setSpecifiers] = useState<string[]>(() => initialDraft?.specifiers ?? []);
  const [specifierText, setSpecifierText] = useState(() => initialDraft?.specifierText ?? "");
  const [excluded, setExcluded] = useState<string[]>(() => initialDraft?.excluded ?? []);
  const [includeCriterionText, setIncludeCriterionText] = useState(() => initialDraft?.includeCriterionText ?? true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<number | null>(null);

  const isDirty =
    Object.keys(statuses).length > 0 || specifiers.length > 0 || specifierText.trim().length > 0 || excluded.length > 0;
  useDirtyStateGuard(isDirty);

  useEffect(() => {
    // The pre-hydration mount never read the draft, so it must not overwrite it.
    if (!restoreDraft) return;
    try {
      if (isDirty || !includeCriterionText) {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ statuses, specifiers, specifierText, excluded, includeCriterionText }),
        );
      } else {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore storage errors
    }
  }, [restoreDraft, storageKey, isDirty, statuses, specifiers, specifierText, excluded, includeCriterionText]);

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

  const resetBuilder = useCallback(() => {
    setStatuses({});
    setSpecifiers([]);
    setSpecifierText("");
    setExcluded([]);
    setIncludeCriterionText(true);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }, [storageKey]);

  useEffect(() => {
    return subscribeAccountTransition(() => {
      resetBuilder();
    });
  }, [resetBuilder]);

  async function copyNote(): Promise<boolean> {
    let copied = false;
    try {
      await copyTextToClipboard(note);
      setCopyState("copied");
      copied = true;
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), COPY_RESET_MS);
    return copied;
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
            autoComplete="off"
            spellCheck={false}
            data-gramm="false"
            data-enable-grammarly="false"
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
              <CopyButton label="Copy note" copied={copyState === "copied"} onClick={copyNote} testId="dsm-note-copy" />
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
