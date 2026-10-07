"use client";

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";

import { CmeAllocationField, isAllocationBalanced, isPlainDecimalText } from "@/components/cme/cme-allocation-field";
import { CmeChoiceChip } from "@/components/cme/cme-choice-chip";
import { CmeDateField } from "@/components/cme/cme-date-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import {
  cn,
  fieldControlPlain,
  fieldControlWithIcon,
  fieldLabel,
  InlineNotice,
  textMuted,
} from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmeDraftPayload } from "@/lib/cme/drafts";
import { parseCmeHours } from "@/lib/cme/hours-input";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { cmeEntryCreateSchema } from "@/lib/cme/schemas";
import { cmeCategoryLabels, cmeCategories, type CmeAllocation, type CmeCategory, type CmeEntry } from "@/lib/cme/types";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";

/**
 * One activity, captured on one sheet: what it was, when, how many hours it
 * ran for, which category those hours count toward, a reflection in the
 * owner's own words, and — behind "More details" — the source link, formal
 * peer-review credit, practice domains and cost.
 *
 * Most activities belong to one category, so the usual path is one tap: the
 * category chip puts every stated hour there. "Split hours" opens the
 * three-way split for the activity that genuinely spans categories.
 *
 * `statedHours` never reaches `onSubmit`. It exists only so the owner has a
 * figure to check the category split against while entering it — the number
 * that actually counts is always the sum of `allocations`, the same figure
 * `src/lib/cme/evaluate.ts` computes everywhere else. The Save control stays
 * disabled until that sum matches what the owner said the activity took.
 */

/** Common CPD durations. "Other" opens a box that takes any figure, including "1,5" and "90 min". */
const HOUR_PRESETS: readonly number[] = [0.5, 1, 1.5, 2, 3];

/** Short chip names. Deliberately not the full category labels, which name the split fields. */
const CATEGORY_CHIP_LABELS: Record<CmeCategory, string> = {
  educational: "Educational",
  reviewing: "Reviewing",
  measuring: "Outcomes",
};

type CategoryMode = CmeCategory | "split" | null;

function initialCategoryMode(allocations: readonly CmeAllocation[] | undefined): CategoryMode {
  if (!allocations || allocations.length === 0) return null;
  if (allocations.length === 1) return allocations[0].category;
  return "split";
}

/**
 * The unsaved new entry, kept in this tab's session storage so a reload, a
 * dropped connection or an accidental back-swipe does not lose it. Session
 * storage rather than local storage on purpose: it ends with the tab, so a
 * half-written reflection is never left on a shared device for the next person
 * who signs in.
 */
type StoredDraft = {
  title: string;
  date: string;
  statedHoursText: string;
  mode: CategoryMode;
  allocations: CmeAllocation[];
  reflection: string;
  sourceUrl: string;
  formalPeerReviewText: string;
  buckets: string[];
  costText: string;
};

function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.title !== "string" || typeof parsed.date !== "string") return null;
    const mode = parsed.mode;
    return {
      title: parsed.title,
      date: parsed.date,
      statedHoursText: typeof parsed.statedHoursText === "string" ? parsed.statedHoursText : "",
      mode:
        mode === "split" || (typeof mode === "string" && (cmeCategories as readonly string[]).includes(mode))
          ? (mode as CategoryMode)
          : null,
      allocations: Array.isArray(parsed.allocations)
        ? parsed.allocations.filter(
            (item): item is CmeAllocation =>
              Boolean(item) &&
              (cmeCategories as readonly string[]).includes((item as CmeAllocation).category) &&
              typeof (item as CmeAllocation).hours === "number",
          )
        : [],
      reflection: typeof parsed.reflection === "string" ? parsed.reflection : "",
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "",
      formalPeerReviewText: typeof parsed.formalPeerReviewText === "string" ? parsed.formalPeerReviewText : "",
      buckets: Array.isArray(parsed.buckets)
        ? parsed.buckets.filter((item): item is string => typeof item === "string")
        : [],
      costText: typeof parsed.costText === "string" ? parsed.costText : "",
    };
  } catch {
    return null;
  }
}

function writeStoredDraft(key: string, draft: StoredDraft | null) {
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked or full: the form still works, it just cannot survive a reload.
  }
}

export type CmeEntryDraft = z.infer<typeof cmeEntryCreateSchema>;

export type CmeEntryFormProps = {
  onSubmit: (entry: CmeEntryDraft) => Promise<void>;
  initialEntry?: Pick<
    CmeEntry,
    | "date"
    | "title"
    | "allocations"
    | "reflection"
    | "costCents"
    | "routineId"
    | "documentId"
    | "sourceUrl"
    | "buckets"
    | "formalPeerReviewHours"
  >;
  /** Null explicitly leaves hours unselected even when a routine suggests a split. */
  initialStatedHours?: number | null;
  /** Existing owner entries, used only to ask before a same-day repeat. */
  existingEntries?: readonly CmeEntry[];
  availableDomains?: readonly string[];
  /**
   * Categories an hours target this year is still short in, furthest from met
   * first. Each gets a "Still short" tag on its chip. A hint only: nothing is
   * preselected, and the tag is absent when the list is empty.
   */
  stillShort?: readonly CmeCategory[];
  submitLabel?: string;
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Where an unsaved NEW entry is kept for this tab (see `StoredDraft`). Only
   * pass it for a new entry: an edit must never be overwritten by a draft.
   * A draft is restored only into a form that opened without a prefilled
   * title, so a routine or learning-source prefill always wins.
   */
  draftStorageKey?: string;
  /**
   * Pin Save to the bottom of the screen while the form scrolls. On by default
   * for the full-page form; a sheet passes false because it has its own frame.
   */
  stickySave?: boolean;
  /** Mount actions in a sheet's fixed footer while retaining this form's submit validation. */
  actionContainer?: HTMLElement | null;
  /**
   * Offers "Save as draft": the form's fields as they stand, saved to the account whether or not
   * they would pass as an activity yet. A draft never counts toward hours.
   */
  onSaveDraft?: (payload: CmeDraftPayload) => Promise<void>;
  /** A saved draft to continue. Its fields fill the form once, after mount. */
  initialDraft?: CmeDraftPayload;
  /** Extra draft controls shown beside "Save as draft" (who the draft is waiting on). */
  draftControls?: ReactNode;
};

/**
 * `null` for blank or unparseable text — a cost the owner never actually
 * stated, not a zero cost. Also `null` for anything but a plain decimal —
 * exponent notation like `"1e10"` would otherwise parse to a real number and
 * slip through as a cost with no upper bound to catch it.
 */
function centsFromDollarText(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!isPlainDecimalText(trimmed)) return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

function parsePositiveHours(raw: string): number {
  if (!isPlainDecimalText(raw)) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function CmeEntryForm({
  onSubmit,
  initialEntry,
  initialStatedHours,
  existingEntries = [],
  availableDomains = [],
  stillShort = [],
  submitLabel = "Save entry",
  onDirtyChange,
  draftStorageKey,
  stickySave = true,
  actionContainer,
  onSaveDraft,
  initialDraft,
  draftControls,
}: CmeEntryFormProps) {
  const formId = useId();
  // Bumped after every successful save to remount CmeAllocationField, which
  // otherwise has no way to clear its own typed-text state from outside.
  const [formKey, setFormKey] = useState(0);
  const today = perthCalendarDate(new Date());
  // Nothing is chosen for a brand-new entry (spec §6.1): hours start empty.
  // Only a prefill — a routine, Log again, a draft, an edit — carries hours in.
  const carriedHours = initialEntry?.allocations.reduce((sum, allocation) => sum + allocation.hours, 0) ?? 0;
  const initialHours =
    initialStatedHours === null
      ? null
      : (initialStatedHours ?? (carriedHours > 0 ? Math.round(carriedHours * 100) / 100 : null));
  const [date, setDate] = useState(() => initialEntry?.date ?? perthCalendarDate(new Date()));
  const [sourceUrl, setSourceUrl] = useState(initialEntry?.sourceUrl ?? "");
  const [title, setTitle] = useState(initialEntry?.title ?? "");
  const [statedHoursText, setStatedHoursText] = useState(initialHours === null ? "" : String(initialHours));
  // True once "Other" is tapped, so the box stays open even while its text matches a chip.
  const [hoursOtherOpen, setHoursOtherOpen] = useState(false);
  const [hoursFocusRequest, setHoursFocusRequest] = useState(0);
  const hoursInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<CategoryMode>(() => initialCategoryMode(initialEntry?.allocations));
  // The split field's own figures. Used only in "split" mode; a single-category
  // choice derives its allocation from the stated hours instead.
  const [splitAllocations, setSplitAllocations] = useState<CmeAllocation[]>(() => [
    ...(initialEntry?.allocations ?? []),
  ]);
  const [splitTotal, setSplitTotal] = useState(() =>
    (initialEntry?.allocations ?? []).reduce((sum, allocation) => sum + allocation.hours, 0),
  );
  const [splitSeed, setSplitSeed] = useState<readonly CmeAllocation[] | undefined>(initialEntry?.allocations);
  const [formalPeerReviewText, setFormalPeerReviewText] = useState(String(initialEntry?.formalPeerReviewHours ?? ""));
  const [buckets, setBuckets] = useState<string[]>(() => [...(initialEntry?.buckets ?? [])]);
  const [reflection, setReflection] = useState(initialEntry?.reflection ?? "");
  const [costText, setCostText] = useState(
    initialEntry?.costCents === null || initialEntry?.costCents === undefined
      ? ""
      : (initialEntry.costCents / 100).toFixed(2),
  );
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [repeatPending, setRepeatPending] = useState<CmeEntryDraft | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(
    () =>
      Boolean(initialEntry?.sourceUrl) ||
      (initialEntry?.formalPeerReviewHours ?? 0) > 0 ||
      (initialEntry?.buckets.length ?? 0) > 0 ||
      (initialEntry?.costCents !== null && initialEntry?.costCents !== undefined),
  );
  const draftRestoreChecked = useRef(false);
  // Smart defaults are suggestions only. A user's own tap or a restored/prefilled form wins.
  const hoursChosenByUser = useRef(false);
  const categoryChosenByUser = useRef(false);
  const autoFilledTitle = useRef<string | null>(null);

  function applyTitleDefaults() {
    if (initialEntry?.title || initialDraft || restoredDraft || (draftStorageKey && !draftRestoreChecked.current))
      return;
    const normalized = title.trim().toLocaleLowerCase("en-AU");
    if (normalized === autoFilledTitle.current) return;
    if (autoFilledTitle.current) {
      if (!hoursChosenByUser.current) {
        setStatedHoursText("");
        setHoursOtherOpen(false);
      }
      if (!categoryChosenByUser.current) {
        setMode(null);
        setSplitAllocations([]);
        setSplitTotal(0);
        setSplitSeed(undefined);
      }
      autoFilledTitle.current = null;
    }
    if (!normalized) return;
    const previous = [...existingEntries]
      .filter((entry) => !entry.archivedAt && entry.title.trim().toLocaleLowerCase("en-AU") === normalized)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!previous || (hoursChosenByUser.current && categoryChosenByUser.current)) return;
    const total = previous.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
    if (!hoursChosenByUser.current && total > 0) {
      setStatedHoursText(String(Math.round(total * 100) / 100));
      setHoursOtherOpen(false);
    }
    if (!categoryChosenByUser.current && previous.allocations.length) {
      setMode(initialCategoryMode(previous.allocations));
      setSplitAllocations([...previous.allocations]);
      setSplitTotal(total);
      setSplitSeed(previous.allocations);
      setFormKey((key) => key + 1);
    }
    autoFilledTitle.current = normalized;
  }

  const statedHours = parseCmeHours(statedHoursText) ?? 0;
  const otherHoursChosen = hoursOtherOpen || (statedHoursText.trim() !== "" && !HOUR_PRESETS.includes(statedHours));
  const allocations: CmeAllocation[] =
    mode === "split"
      ? splitAllocations
      : mode !== null && statedHours > 0
        ? [{ category: mode, hours: statedHours }]
        : [];
  const allocatedTotal = mode === "split" ? splitTotal : mode !== null ? statedHours : 0;
  const balanced = isAllocationBalanced(allocatedTotal, statedHours);
  const costTrimmed = costText.trim();
  const costValid = costTrimmed === "" || centsFromDollarText(costTrimmed) !== null;
  const formalPeerReviewValid = formalPeerReviewText.trim() === "" || isPlainDecimalText(formalPeerReviewText);
  const formalPeerReviewHours = formalPeerReviewText.trim() === "" ? 0 : parsePositiveHours(formalPeerReviewText);

  const draft: CmeEntryDraft = {
    date,
    title: title.trim(),
    allocations,
    reflection,
    costCents: centsFromDollarText(costText),
    routineId: null,
    documentId: null,
    sourceUrl: sourceUrl.trim() || null,
    buckets,
    formalPeerReviewHours,
  };
  if (initialEntry?.routineId) draft.routineId = initialEntry.routineId;
  if (initialEntry?.documentId) draft.documentId = initialEntry.documentId;
  const parsedDraft = cmeEntryCreateSchema.safeParse(draft);
  const canSave = balanced && allocations.length > 0 && costValid && formalPeerReviewValid && parsedDraft.success;
  // Save used to sit greyed out with nothing saying why. Name the first thing
  // standing in the way, in the order the fields appear on the form.
  const firstDraftIssue = parsedDraft.success ? null : parsedDraft.error.issues[0]?.path[0];
  const saveBlockedReason = canSave
    ? null
    : !draft.title
      ? "Add what the activity was to save it."
      : firstDraftIssue === "date"
        ? "Choose a valid date to save it."
        : statedHours <= 0
          ? "Enter how many hours it took to save it."
          : mode === null
            ? "Choose which category the hours count toward to save it."
            : allocations.length === 0 || !balanced
              ? "Split every hour across the categories to save it."
              : !formalPeerReviewValid
                ? "Peer-review credit cannot be more than the reviewing-performance hours."
                : firstDraftIssue === "reflection"
                  ? "Shorten the reflection to 2000 characters to save it."
                  : firstDraftIssue === "sourceUrl"
                    ? "Check the learning source link, or leave it blank."
                    : !costValid
                      ? "Fix the cost, or leave it blank."
                      : "Check the details above to save it.";
  const initialFingerprint = useMemo(
    () =>
      JSON.stringify({
        date: initialEntry?.date ?? perthCalendarDate(new Date()),
        title: initialEntry?.title ?? "",
        allocations: initialEntry?.allocations ?? [],
        reflection: initialEntry?.reflection ?? "",
        costCents: initialEntry?.costCents ?? null,
        routineId: initialEntry?.routineId ?? null,
        documentId: initialEntry?.documentId ?? null,
        sourceUrl: initialEntry?.sourceUrl ?? null,
        buckets: initialEntry?.buckets ?? [],
        formalPeerReviewHours: initialEntry?.formalPeerReviewHours ?? 0,
      }),
    [initialEntry],
  );
  const dirty = JSON.stringify(draft) !== initialFingerprint;

  useDirtyStateGuard(dirty && !saving);

  useEffect(() => {
    onDirtyChange?.(dirty);
    const guardLink = (event: MouseEvent) => {
      if (!dirty || saving || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      // A link marked to keep the draft (the quick-log sheet's "Open the full
      // page") carries the unsaved entry with it, so there is nothing to discard.
      if (!link || (draftStorageKey && link.hasAttribute("data-cme-keeps-draft"))) return;
      if (window.confirm("Discard your unsaved changes?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", guardLink, true);
    return () => {
      document.removeEventListener("click", guardLink, true);
    };
  }, [dirty, draftStorageKey, onDirtyChange, saving]);

  useEffect(() => {
    if (hoursFocusRequest > 0) hoursInputRef.current?.focus();
  }, [hoursFocusRequest]);

  // Restore once, after mount: session storage does not exist on the server,
  // and reading it during render would make the first client render disagree
  // with the server's. The read is scheduled as a callback, the way any other
  // external source hands state to React.
  useEffect(() => {
    if ((!draftStorageKey && !initialDraft) || draftRestoreChecked.current) return;
    const timer = window.setTimeout(() => {
      draftRestoreChecked.current = true;
      if (initialEntry?.title) return;
      const stored: StoredDraft | null = initialDraft
        ? { ...initialDraft, allocations: [...initialDraft.allocations], buckets: [...initialDraft.buckets] }
        : draftStorageKey
          ? readStoredDraft(draftStorageKey)
          : null;
      if (!stored || (!stored.title.trim() && !stored.reflection.trim())) return;
      setTitle(stored.title);
      setDate(stored.date);
      setStatedHoursText(stored.statedHoursText);
      setMode(stored.mode);
      setSplitAllocations(stored.allocations);
      setSplitTotal(stored.allocations.reduce((sum, allocation) => sum + allocation.hours, 0));
      setSplitSeed(stored.allocations);
      setReflection(stored.reflection);
      setSourceUrl(stored.sourceUrl);
      setFormalPeerReviewText(stored.formalPeerReviewText);
      setBuckets(stored.buckets);
      setCostText(stored.costText);
      hoursChosenByUser.current = true;
      categoryChosenByUser.current = true;
      if (stored.sourceUrl || stored.formalPeerReviewText || stored.buckets.length > 0 || stored.costText) {
        setDetailsOpen(true);
      }
      setFormKey((key) => key + 1);
      // A continued account draft is announced by the page; this notice is for the tab's own copy.
      if (!initialDraft) setRestoredDraft(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, initialDraft, initialEntry?.title]);

  useEffect(() => {
    if (!draftStorageKey || !draftRestoreChecked.current || saving) return;
    if (!title.trim() && !reflection.trim()) {
      writeStoredDraft(draftStorageKey, null);
      return;
    }
    writeStoredDraft(draftStorageKey, {
      title,
      date,
      statedHoursText,
      mode,
      allocations: splitAllocations,
      reflection,
      sourceUrl,
      formalPeerReviewText,
      buckets,
      costText,
    });
  }, [
    buckets,
    costText,
    date,
    draftStorageKey,
    formalPeerReviewText,
    mode,
    reflection,
    saving,
    sourceUrl,
    splitAllocations,
    statedHoursText,
    title,
  ]);

  function resetFields() {
    hoursChosenByUser.current = false;
    categoryChosenByUser.current = false;
    autoFilledTitle.current = null;
    setDate(perthCalendarDate(new Date()));
    setTitle("");
    setSourceUrl("");
    setStatedHoursText("");
    setHoursOtherOpen(false);
    setMode(null);
    setSplitAllocations([]);
    setSplitTotal(0);
    setSplitSeed(undefined);
    setFormalPeerReviewText("");
    setBuckets([]);
    setReflection("");
    setCostText("");
    setFormKey((key) => key + 1);
  }

  function discardDraft() {
    if (draftStorageKey) writeStoredDraft(draftStorageKey, null);
    resetFields();
    setRestoredDraft(false);
  }

  // Reads the latest form state when an account transition fires, without resubscribing each render.
  const onAccountTransition = useEffectEvent(() => discardDraft());
  useEffect(() => subscribeAccountTransition(onAccountTransition), []);

  async function handleSaveDraft() {
    if (!onSaveDraft || savingDraft || saving) return;
    setSubmitError(null);
    setSavingDraft(true);
    try {
      await onSaveDraft({
        title,
        date,
        statedHoursText,
        mode,
        allocations: splitAllocations,
        reflection,
        sourceUrl,
        formalPeerReviewText,
        buckets,
        costText,
        routineId: initialEntry?.routineId ?? null,
        documentId: initialEntry?.documentId ?? null,
      });
      if (draftStorageKey) writeStoredDraft(draftStorageKey, null);
    } catch (error) {
      setSubmitError(cmeSaveErrorText(error, "Could not save this draft."));
    } finally {
      setSavingDraft(false);
    }
  }

  function handleAllocationChange(nextAllocations: readonly CmeAllocation[], total: number) {
    categoryChosenByUser.current = true;
    hoursChosenByUser.current = true;
    setSplitAllocations([...nextAllocations]);
    setSplitTotal(total);
  }

  async function performSave(data: CmeEntryDraft) {
    setSubmitError(null);
    setSaving(true);
    try {
      await onSubmit(data);
      if (draftStorageKey) writeStoredDraft(draftStorageKey, null);
      setRestoredDraft(false);
      resetFields();
    } catch (error) {
      setSubmitError(cmeSaveErrorText(error, "Could not save this entry."));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || saving || !parsedDraft.success) return;
    const proposed = parsedDraft.data;
    const sameTitle = proposed.title.trim().toLocaleLowerCase("en-AU");
    if (
      existingEntries.some(
        (entry) =>
          !entry.archivedAt &&
          entry.date === proposed.date &&
          entry.title.trim().toLocaleLowerCase("en-AU") === sameTitle,
      )
    ) {
      setRepeatPending(proposed);
      return;
    }
    void performSave(proposed);
  }

  // In a sheet footer the mockup names the hours ("Save 1 h") once they are
  // chosen. The page form keeps its own label.
  const saveLabel = actionContainer && statedHours > 0 ? `Save ${statedHours}\u00a0h` : submitLabel;
  const saveButton = (
    <Button
      type="submit"
      form={formId}
      variant="primary"
      // aria-disabled rather than disabled: Save keeps its Tab stop, so the
      // reason under it can be reached by keyboard (docs/wiring-conventions.md).
      // handleSubmit refuses to save while !canSave.
      aria-disabled={!canSave || undefined}
      busy={saving}
      busyLabel="Saving…"
      block
      aria-describedby={saveBlockedReason ? "cme-entry-save-blocked" : undefined}
    >
      {saveLabel}
    </Button>
  );
  const saveReason = saveBlockedReason ? (
    <p
      id="cme-entry-save-blocked"
      data-testid="cme-entry-save-blocked"
      className={cn("mt-2 text-center text-xs", textMuted)}
    >
      {saveBlockedReason}
    </p>
  ) : null;
  const saveControl = (
    <>
      {saveButton}
      {saveReason}
    </>
  );

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <ConfirmDialog
        open={repeatPending !== null}
        onCancel={() => setRepeatPending(null)}
        onConfirm={() => {
          const pending = repeatPending;
          setRepeatPending(null);
          if (pending) void performSave(pending);
        }}
        title="Log it again?"
        description="You logged this today already. Log it again?"
        confirmLabel="Log again"
        tone="primary"
      />
      {submitError ? <InlineNotice tone="neutral">{submitError}</InlineNotice> : null}
      {restoredDraft ? (
        <div data-testid="cme-entry-draft-restored">
          <InlineNotice tone="neutral">
            <span>We kept the entry you had not saved yet.</span>{" "}
            <button
              type="button"
              onClick={discardDraft}
              className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
            >
              Start again
            </button>
          </InlineNotice>
        </div>
      ) : null}

      <TextField
        label="What was it"
        id="cme-entry-title"
        required
        placeholder="Grand round, course, reading…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={applyTitleDefaults}
      />

      <CmeDateField
        label="Date"
        id="cme-entry-date"
        required
        allowFuture={false}
        today={today}
        value={date}
        onChange={setDate}
      />

      <fieldset data-testid="cme-entry-hours" className="min-w-0">
        <legend className={fieldLabel}>Hours</legend>
        <div className="flex flex-wrap gap-x-2">
          {HOUR_PRESETS.map((preset) => (
            <CmeChoiceChip
              key={preset}
              pressed={!otherHoursChosen && statedHours === preset}
              onPress={() => {
                hoursChosenByUser.current = true;
                setHoursOtherOpen(false);
                setStatedHoursText(String(preset));
              }}
            >
              {String(preset)}
            </CmeChoiceChip>
          ))}
          <CmeChoiceChip
            pressed={otherHoursChosen}
            onPress={() => {
              hoursChosenByUser.current = true;
              setHoursOtherOpen(true);
              setHoursFocusRequest((count) => count + 1);
            }}
            testId="cme-entry-hours-other"
          >
            Other
          </CmeChoiceChip>
        </div>
        {otherHoursChosen ? (
          <TextField
            ref={hoursInputRef}
            label="Hours for this activity"
            hideLabel
            id="cme-entry-stated-hours"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1.25 or 90 min"
            value={statedHoursText}
            onChange={(event) => {
              hoursChosenByUser.current = true;
              setStatedHoursText(event.target.value);
            }}
            fieldClassName="mt-1"
          />
        ) : null}
      </fieldset>

      <fieldset data-testid="cme-entry-category">
        <legend className="text-sm font-semibold text-[color:var(--text)]">Counts toward</legend>
        <p className={cn(textMuted, "mt-1 text-xs")}>
          One tap puts every hour in that category. Choose Split hours if it genuinely covered more than one.
        </p>
        <div className="mt-1 flex flex-wrap gap-x-2">
          {cmeCategories.map((category) => (
            <CmeChoiceChip
              key={category}
              pressed={mode === category}
              title={cmeCategoryLabels[category]}
              ariaDescribedBy={stillShort.includes(category) ? `${formId}-still-short-${category}` : undefined}
              onPress={() => {
                categoryChosenByUser.current = true;
                setMode(category);
              }}
            >
              {CATEGORY_CHIP_LABELS[category]}
              {stillShort.includes(category) ? (
                // Described, not named: the chip is still called by its
                // category, and a screen reader adds "Still short" after it.
                <span
                  aria-hidden="true"
                  id={`${formId}-still-short-${category}`}
                  className="work-tag"
                  data-testid={`cme-entry-still-short-${category}`}
                >
                  Still short
                </span>
              ) : null}
            </CmeChoiceChip>
          ))}
          <CmeChoiceChip
            pressed={mode === "split"}
            onPress={() => {
              categoryChosenByUser.current = true;
              setMode("split");
            }}
          >
            Split hours
          </CmeChoiceChip>
        </div>
      </fieldset>

      {mode === "split" ? (
        <CmeAllocationField
          key={formKey}
          statedHours={statedHours}
          onChange={handleAllocationChange}
          idPrefix="cme-entry-allocation"
          initialAllocations={splitSeed}
        />
      ) : null}

      <FormField
        label="Reflection"
        id="cme-entry-reflection"
        hint="In your own words — this is the part an audit actually reads."
      >
        {(field) => (
          <textarea
            id={field.id}
            aria-describedby={field.describedBy}
            rows={2}
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            className={cn(fieldControlPlain, "h-auto min-h-16 resize-y py-2 leading-6")}
          />
        )}
      </FormField>

      <p data-testid="cme-entry-privacy" className={cn(textMuted, "text-sm leading-5")}>
        Keep it free of patient names, initials, dates of birth, record numbers and other identifiers.
      </p>

      <details
        data-testid="cme-entry-more-details"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className="rounded-lg border border-[color:var(--border)]"
      >
        <summary className="flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold text-[color:var(--text)]">
          More details
          <span className={cn(textMuted, "ml-2 text-xs font-normal")}>source, peer review, domains, cost</span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-[color:var(--border)] p-3">
          <TextField
            label="Learning source URL (optional)"
            value={sourceUrl}
            maxLength={2000}
            onChange={(event) => setSourceUrl(event.target.value)}
            hint="A source link is not evidence of participation. Record only what you completed."
          />

          <TextField
            label="Formal peer-review credit"
            id="cme-entry-peer-review-hours"
            type="text"
            inputMode="decimal"
            value={formalPeerReviewText}
            onChange={(event) => setFormalPeerReviewText(event.target.value)}
            hint="Credit within reviewing-performance hours; it does not add extra hours."
          />
          {!formalPeerReviewValid ? (
            <p className={cn("-mt-4 text-xs font-medium", textMuted)}>Use a positive plain number, such as 1 or 1.5.</p>
          ) : null}

          {availableDomains.length > 0 ? (
            <fieldset>
              <legend className="text-sm font-semibold text-[color:var(--text)]">Practice domains</legend>
              <p className={cn(textMuted, "mt-1 text-xs")}>Select only the domains this activity actually addressed.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {availableDomains.map((domain) => (
                  <Checkbox
                    key={domain}
                    label={domain}
                    checked={buckets.includes(domain)}
                    onChange={(event) =>
                      setBuckets((current) =>
                        event.target.checked ? [...current, domain] : current.filter((item) => item !== domain),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          ) : null}

          <FormField label="What it cost" id="cme-entry-cost" describedBy="cme-entry-cost-optional">
            {(field) => (
              <>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium",
                      textMuted,
                    )}
                  >
                    $
                  </span>
                  <input
                    id={field.id}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-describedby={field.describedBy}
                    value={costText}
                    onChange={(event) => setCostText(event.target.value)}
                    className={fieldControlWithIcon}
                  />
                </div>
                <p
                  id="cme-entry-cost-optional"
                  data-testid="cme-cost-optional"
                  className={cn("mt-1.5 text-xs", textMuted)}
                >
                  Optional — leave this blank if it did not cost you anything.
                </p>
                {!costValid ? (
                  <p className={cn("mt-1 text-xs font-medium", textMuted)}>Numbers only, like 45 or 45.50.</p>
                ) : null}
              </>
            )}
          </FormField>
        </div>
      </details>

      {onSaveDraft ? (
        <div
          data-testid="cme-entry-draft-controls"
          className="flex flex-col gap-3 rounded-lg border border-[color:var(--border)] p-3"
        >
          <p className={cn(textMuted, "text-sm")}>
            Not finished? Save it as a draft on your account and come back to it. A draft never counts toward your
            hours.
          </p>
          {draftControls}
          {!actionContainer ? (
            <Button
              type="button"
              busy={savingDraft}
              busyLabel="Saving draft…"
              disabled={saving || (!title.trim() && !reflection.trim())}
              onClick={() => void handleSaveDraft()}
              testId="cme-entry-save-draft"
            >
              Save as draft
            </Button>
          ) : null}
        </div>
      ) : null}

      {actionContainer ? (
        createPortal(
          <div>
            <div className="flex gap-2">
              {onSaveDraft ? (
                <div className="min-w-0 flex-1">
                  <Button
                    type="button"
                    variant="secondary"
                    busy={savingDraft}
                    busyLabel="Saving draft…"
                    disabled={saving || (!title.trim() && !reflection.trim())}
                    onClick={() => void handleSaveDraft()}
                    testId="cme-entry-save-draft"
                    block
                  >
                    Save as draft
                  </Button>
                </div>
              ) : null}
              <div className="min-w-0 flex-[1.4]">{saveButton}</div>
            </div>
            {saveReason}
          </div>,
          actionContainer,
        )
      ) : stickySave ? (
        // Pinned while the form scrolls, so Save is never a long scroll away on
        // a phone. The page's own background sits behind it so text scrolling
        // underneath never shows through.
        <div
          data-testid="cme-entry-save-bar"
          className="sticky bottom-0 z-[var(--z-raised)] -mx-4 border-t border-[color:var(--border)] bg-[color:var(--background)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0"
        >
          {saveControl}
        </div>
      ) : (
        <div>{saveControl}</div>
      )}
    </form>
  );
}
