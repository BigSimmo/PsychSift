"use client";

import { Eraser, Plus, UserRound, X } from "lucide-react";
import { useId, useState } from "react";

import { usePatientProfile } from "@/components/clinical-dashboard/patient-profile-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChoiceChip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";
import { cn, fieldLabel, ToggleSwitch } from "@/components/ui-primitives";
import { catalogueMedicationOptions, medicationDisplayName } from "@/lib/medication-interactions";
import { SCR_UMOL_PER_MGDL } from "@/lib/medication-patient-alerts";
import type { AllergyClass, HepaticSeverity, ScrUnit } from "@/lib/medication-patient-alerts";
import { PATIENT_PROFILE_NUMERIC_BOUNDS, PATIENT_PROFILE_SCR_UMOL_BOUNDS } from "@/lib/patient-profile-storage";

/**
 * "Not set" is a real segment, not the absence of a selection.
 *
 * The engine already treats `hepatic: "none"` as present-and-non-firing (it
 * tests `hepatic !== "none"` rather than falsiness), so "assessed, no
 * impairment" clears a hepatic gate while a null leaves it unassessed. Storing
 * "None" as null collapsed those two states into one: selecting None was
 * indistinguishable from never touching the field, and the control then
 * displayed "None" for a profile that recorded nothing at all. The sentinel is
 * a display-only value — it is written through as `null`, never stored.
 *
 * The label is "Not set" rather than the more descriptive "Not recorded"
 * because this is a five-segment `layout="equal"` control: at a 320px viewport
 * each segment is ~50px, and "Not recorded" truncated to "Not recor…" beside a
 * fully legible "None". Truncating the default state of the one control whose
 * entire purpose is separating "no answer" from "answered: no impairment" is
 * the wrong thing to shorten by ellipsis, so it is shortened by wording.
 */
const HEPATIC_UNRECORDED = "unrecorded" as const;

type HepaticSegment = HepaticSeverity | typeof HEPATIC_UNRECORDED;

const HEPATIC_OPTIONS: { value: HepaticSegment; label: string }[] = [
  { value: HEPATIC_UNRECORDED, label: "Not set" },
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

const SCR_UNIT_OPTIONS: { value: ScrUnit; label: string }[] = [
  { value: "umol/L", label: "µmol/L" },
  { value: "mg/dL", label: "mg/dL" },
];

const ALLERGY_OPTIONS: { value: AllergyClass; label: string }[] = [
  { value: "penicillin", label: "Penicillin" },
  { value: "sulfa", label: "Sulfa" },
  { value: "nsaid", label: "NSAID" },
  { value: "cephalosporin", label: "Cephalosporin" },
  { value: "macrolide", label: "Macrolide" },
  { value: "fluoroquinolone", label: "Fluoroquinolone" },
];

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const segmentBase =
  "min-h-tap rounded-lg border px-2.5 text-2xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:text-xs";
const segmentActive =
  "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
const segmentIdle =
  "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)]";

function NumberField({
  label,
  unit,
  value,
  onChange,
  testId,
  min,
  max,
  step,
  resetNonce,
}: {
  label: string;
  unit?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  testId?: string;
  min: number;
  max: number;
  step?: number | string;
  /** Changes whenever the whole profile is cleared, from anywhere. */
  resetNonce: number;
}) {
  // Invariant: unless the field is flagged out-of-range, the text on screen is a
  // number the shared profile actually holds. The box owns its draft only for as
  // long as the store still agrees with the value that draft last committed.
  //
  // `committed` is what THIS field last wrote — `null` for a partial or
  // out-of-range entry, which is rejected rather than stored. Comparing the
  // incoming value against it, instead of against the previous prop, is what
  // separates this field's own write echoing back through the store from news
  // arriving elsewhere (a second mounted copy of the panel, a unit conversion, a
  // clear), and the two need opposite handling:
  //
  //   echo -> leave the text exactly as typed. Re-deriving it from the number
  //           rewrites "095" to "95" and "1.0" to "1" between keystrokes, which
  //           moves the caret and, in the creatinine field, turns an in-progress
  //           "1.02" into "12".
  //   news -> adopt it, even over an out-of-range draft. The previous version
  //           skipped the sync whenever the current text was out of range, so a
  //           rejected entry stayed on screen indefinitely while the profile held
  //           something else: #WFARS3, where a refused CrCl "420" was still in the
  //           box when 95 was typed after it, reading 42095, and where one mount
  //           could show 420 while the alert engine ran on the 95 another mount
  //           had stored.
  //
  // Out-of-range text is still kept for in-place correction: a rejection writes
  // `null`, which equals `committed`, so nothing re-syncs and the error stays.
  //
  // Which is precisely why the store alone cannot end that hold. A clear also
  // writes `null`, so `incoming !== committed` is false either way and the
  // refused text sits there through a clear performed anywhere else — #DTAMMK,
  // where panel A kept showing a refused CrCl of 420 after panel B wiped the
  // profile, and the 95 typed next read 42095. `resetNonce` is the missing
  // signal: it changes on every profile-wide clear, whoever asked for it, and
  // it is the ONLY thing that can distinguish the two identical nulls.
  const [text, setText] = useState(value == null ? "" : String(value));
  const [committed, setCommitted] = useState<number | null>(value ?? null);
  const [syncedNonce, setSyncedNonce] = useState(resetNonce);

  const incoming = value ?? null;
  if (syncedNonce !== resetNonce) {
    // A clear outranks the hold: adopt the store unconditionally, error and all.
    setSyncedNonce(resetNonce);
    setCommitted(incoming);
    setText(incoming == null ? "" : String(incoming));
  } else if (incoming !== committed) {
    setCommitted(incoming);
    setText(incoming == null ? "" : String(incoming));
  }

  const parsed = parseNumber(text);
  const outOfRange = parsed !== null && (parsed < min || parsed > max);

  return (
    <TextField
      label={unit ? `${label} (${unit})` : label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        const entered = parseNumber(raw);
        const next = entered !== null && entered >= min && entered <= max ? entered : null;
        setText(raw);
        setCommitted(next);
        onChange(next);
      }}
      error={outOfRange ? `Enter ${min}–${max}${unit ? ` ${unit}` : ""}.` : undefined}
      className="nums"
      data-testid={testId}
    />
  );
}

function MedicationPicker({
  selected,
  onToggle,
  resetNonce,
}: {
  selected: string[];
  onToggle: (slug: string) => void;
  resetNonce: number;
}) {
  const [term, setTerm] = useState("");
  const listId = useId();

  // Clearing the profile empties the search box too. Done as React's sanctioned
  // "adjust state during render" reconciliation rather than an effect: a
  // setState inside useEffect renders once with the stale value and trips
  // `react-hooks/set-state-in-effect`.
  const [syncedNonce, setSyncedNonce] = useState(resetNonce);
  if (syncedNonce !== resetNonce) {
    setSyncedNonce(resetNonce);
    setTerm("");
  }

  const options = catalogueMedicationOptions();
  const selectedSet = new Set(selected);
  const query = term.trim().toLowerCase();
  const matches = query
    ? options.filter((option) => option.name.toLowerCase().includes(query) && !selectedSet.has(option.slug)).slice(0, 8)
    : [];

  return (
    <fieldset className="min-w-0">
      <legend className={fieldLabel}>Current medications</legend>

      {selected.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" data-testid="patient-medication-list">
          {selected.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                onClick={() => onToggle(slug)}
                data-testid={`patient-medication-${slug}`}
                aria-label={`Remove ${medicationDisplayName(slug)}`}
                className={cn(segmentBase, segmentActive, "inline-flex items-center gap-1.5")}
              >
                {medicationDisplayName(slug)}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <TextField
        label="Add a medication"
        hideLabel
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search medications to add…"
        aria-describedby={listId}
        data-testid="patient-medication-search"
      />

      <div id={listId} className="mt-1.5 flex flex-wrap gap-1.5">
        {matches.map((option) => (
          <button
            key={option.slug}
            type="button"
            onClick={() => {
              onToggle(option.slug);
              setTerm("");
            }}
            data-testid={`patient-medication-add-${option.slug}`}
            className={cn(segmentBase, segmentIdle, "inline-flex items-center gap-1.5")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {option.name}
          </button>
        ))}
        {query && matches.length === 0 ? (
          <p className="text-2xs text-[color:var(--text-muted)]">
            No catalogue match. Only medications in this catalogue can be interaction-checked.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

export function PatientProfilePanel({
  variant = "full",
  defaultOpen,
  className,
}: {
  variant?: "full" | "compact";
  defaultOpen?: boolean;
  className?: string;
}) {
  const { profile, updateField, setScrUnit, toggleAllergy, toggleMedication, clear, clearGeneration, isEmpty } =
    usePatientProfile();
  const [open, setOpen] = useState(defaultOpen ?? variant === "full");
  // The reset nonce used to be `useState(0)` here, bumped only by the Clear
  // button below — so it could only ever see a clear this very component asked
  // for. A second mounted copy of the panel, or sign-out, wiped the profile
  // without it ever changing, and every field on this mount held its refused
  // draft (#DTAMMK). The shared generation is the same signal at the right
  // scope: this panel's own Clear bumps it too, through the context.
  const resetNonce = clearGeneration;
  const allergies = new Set(profile.allergies ?? []);
  const scrUnit = profile.scrUnit ?? "umol/L";
  const scrBounds =
    scrUnit === "mg/dL"
      ? {
          min: Math.ceil((PATIENT_PROFILE_SCR_UMOL_BOUNDS.min / SCR_UMOL_PER_MGDL) * 100) / 100,
          max: Math.floor((PATIENT_PROFILE_SCR_UMOL_BOUNDS.max / SCR_UMOL_PER_MGDL) * 100) / 100,
        }
      : PATIENT_PROFILE_SCR_UMOL_BOUNDS;

  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      data-testid="patient-profile-panel"
      className={cn(
        "group overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-inset)]",
        className,
      )}
    >
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-left [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden="true" />
          <span className="text-sm-minus font-semibold text-[color:var(--text-heading)]">Patient details</span>
          {!isEmpty ? (
            <span className="rounded-full bg-[color:var(--clinical-accent-soft)] px-2 py-0.5 text-2xs font-semibold text-[color:var(--clinical-accent)]">
              Active
            </span>
          ) : (
            <span className="text-2xs font-medium text-[color:var(--text-muted)]">Optional</span>
          )}
        </span>
        <span className="text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          {open ? "Hide" : "Edit"}
        </span>
      </summary>

      <div className="space-y-3 border-t border-[color:var(--border)] p-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <NumberField
            label="Age"
            unit="years"
            value={profile.ageYears}
            onChange={(value) => updateField("ageYears", value)}
            testId="patient-age"
            min={PATIENT_PROFILE_NUMERIC_BOUNDS.ageYears.min}
            max={PATIENT_PROFILE_NUMERIC_BOUNDS.ageYears.max}
            resetNonce={resetNonce}
          />
          <NumberField
            label="eGFR"
            unit="mL/min"
            value={profile.egfr}
            onChange={(value) => updateField("egfr", value)}
            testId="patient-egfr"
            min={PATIENT_PROFILE_NUMERIC_BOUNDS.egfr.min}
            max={PATIENT_PROFILE_NUMERIC_BOUNDS.egfr.max}
            resetNonce={resetNonce}
          />
          <NumberField
            label="CrCl"
            unit="mL/min"
            value={profile.crcl}
            onChange={(value) => updateField("crcl", value)}
            testId="patient-crcl"
            min={PATIENT_PROFILE_NUMERIC_BOUNDS.crcl.min}
            max={PATIENT_PROFILE_NUMERIC_BOUNDS.crcl.max}
            resetNonce={resetNonce}
          />
          <NumberField
            label="QTc"
            unit="ms"
            value={profile.qtc}
            onChange={(value) => updateField("qtc", value)}
            testId="patient-qtc"
            min={PATIENT_PROFILE_NUMERIC_BOUNDS.qtc.min}
            max={PATIENT_PROFILE_NUMERIC_BOUNDS.qtc.max}
            resetNonce={resetNonce}
          />
          <div className="col-span-2 sm:col-span-1">
            <NumberField
              // Still keyed on the unit, and only on the unit. Switching unit
              // changes the bounds under a draft the store never accepted (200
              // is absurd as mg/dL, ordinary as µmol/L), and a fresh mount is
              // the honest way to drop text whose verdict just changed. The
              // clear case is handled in place instead — see `resetNonce`.
              key={`scr-${scrUnit}`}
              label="Serum creatinine"
              // Names the selected unit so the range message does too (#HXC4D4).
              unit={scrUnit === "mg/dL" ? "mg/dL" : "µmol/L"}
              value={profile.scr}
              onChange={(value) => updateField("scr", value)}
              testId="patient-scr"
              min={scrBounds.min}
              max={scrBounds.max}
              step={scrUnit === "mg/dL" ? "0.01" : "1"}
              resetNonce={resetNonce}
            />
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <span id="patient-scr-unit-label" className={fieldLabel}>
              Creatinine unit
            </span>
            <SegmentedControl
              ariaLabelledBy="patient-scr-unit-label"
              value={profile.scrUnit ?? "umol/L"}
              onChange={setScrUnit}
              options={SCR_UNIT_OPTIONS}
              layout="equal"
            />
          </div>
        </div>

        <div className="min-w-0">
          <span id="patient-hepatic-label" className={fieldLabel}>
            Hepatic impairment
          </span>
          <SegmentedControl
            ariaLabelledBy="patient-hepatic-label"
            value={profile.hepatic ?? HEPATIC_UNRECORDED}
            onChange={(value) => updateField("hepatic", value === HEPATIC_UNRECORDED ? null : value)}
            options={HEPATIC_OPTIONS}
            layout="equal"
          />
        </div>

        <MedicationPicker selected={profile.medications ?? []} onToggle={toggleMedication} resetNonce={resetNonce} />

        <fieldset className="min-w-0">
          <legend className={fieldLabel}>Allergies</legend>
          <div className="flex flex-wrap gap-2">
            {ALLERGY_OPTIONS.map((option) => {
              const active = allergies.has(option.value);
              return (
                <ChoiceChip
                  key={option.value}
                  pressed={active}
                  onPressedChange={() => toggleAllergy(option.value)}
                  size="compact"
                  testId={`patient-allergy-${option.value}`}
                >
                  {option.label}
                </ChoiceChip>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 items-center gap-x-3 gap-y-2 sm:flex sm:flex-wrap">
          <span className="flex min-w-0 items-center gap-1.5 text-sm-minus font-semibold text-[color:var(--text-heading)]">
            <ToggleSwitch
              enabled={profile.pregnant ?? false}
              onToggle={() => updateField("pregnant", !profile.pregnant)}
              aria-label="Pregnancy"
            />
            Pregnancy
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm-minus font-semibold text-[color:var(--text-heading)]">
            <ToggleSwitch
              enabled={profile.breastfeeding ?? false}
              onToggle={() => updateField("breastfeeding", !profile.breastfeeding)}
              aria-label="Breastfeeding"
            />
            Breastfeeding
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={isEmpty}
            className="col-span-2 inline-flex min-h-tap items-center justify-self-end gap-1.5 rounded-lg border border-[color:var(--border)] px-2.5 text-2xs font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </button>
        </div>

        <p className="text-2xs leading-4 text-[color:var(--text-muted)]">
          Anonymous values only — no patient‑identifying information is stored. Cleared when the tab closes. Clinical
          reference — not validated decision support.
        </p>
      </div>
    </details>
  );
}
