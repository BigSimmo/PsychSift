"use client";

import { Activity, ChevronDown, ChevronUp, Calculator, FlaskConical, HeartPulse } from "lucide-react";
import React, { useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, toneDanger, toneSuccess, toneWarning } from "@/components/ui-primitives";
import {
  CREATININE_UMOL_PER_MG_DL,
  calculateCkdEpi2021,
  calculateCockcroftGault,
  calculateProportionalLithiumDose,
  calculateQtc,
  evaluateLithiumLevel,
  type BiologicalSex,
  type CreatinineUnit,
  type LithiumIndication,
} from "@/lib/calculators/clinical-math";

type ActiveTab = "renal" | "qtc" | "lithium";

export interface ClinicalMathPanelProps {
  defaultOpen?: boolean;
  defaultTab?: ActiveTab;
}

function parseStrictNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * Everything the clinician has entered. The calculator page keeps one copy and hands it to
 * whichever panel is mounted, so crossing the desktop breakpoint (the panel moves between the
 * sidebar and the mobile column) does not wipe the entries. It lives in memory only.
 */
export function useClinicalMathPanelState({ defaultOpen = false, defaultTab = "renal" }: ClinicalMathPanelProps = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<ActiveTab>(defaultTab);

  // Renal state
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<BiologicalSex>("male");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [creatinine, setCreatinine] = useState("");
  const [creatinineUnit, setCreatinineUnit] = useState<CreatinineUnit>("umol/L");

  // QTc state
  const [qtMs, setQtMs] = useState("");
  const [hrBpm, setHrBpm] = useState("");

  // Lithium state
  const [lithiumLevel, setLithiumLevel] = useState("");
  const [lithiumIndication, setLithiumIndication] = useState<LithiumIndication>("maintenance");
  const [currentDoseMg, setCurrentDoseMg] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [tabletIncrementMg, setTabletIncrementMg] = useState<125 | 225 | 250 | 450>(125);

  return {
    open,
    setOpen,
    activeTab,
    setActiveTab,
    age,
    setAge,
    sex,
    setSex,
    weightKg,
    setWeightKg,
    heightCm,
    setHeightCm,
    creatinine,
    setCreatinine,
    creatinineUnit,
    setCreatinineUnit,
    qtMs,
    setQtMs,
    hrBpm,
    setHrBpm,
    lithiumLevel,
    setLithiumLevel,
    lithiumIndication,
    setLithiumIndication,
    currentDoseMg,
    setCurrentDoseMg,
    targetLevel,
    setTargetLevel,
    tabletIncrementMg,
    setTabletIncrementMg,
  };
}

export type ClinicalMathPanelState = ReturnType<typeof useClinicalMathPanelState>;

type ClinicalMathPanelControlledProps = { state: ClinicalMathPanelState; defaultOpen?: never; defaultTab?: never };
type ClinicalMathPanelUncontrolledProps = ClinicalMathPanelProps & { state?: never };

export function ClinicalMathPanel(props: ClinicalMathPanelControlledProps | ClinicalMathPanelUncontrolledProps) {
  if ("state" in props) return <ControlledClinicalMathPanel state={props.state} />;
  return <UncontrolledClinicalMathPanel {...props} />;
}

function UncontrolledClinicalMathPanel({ defaultOpen = false, defaultTab = "renal" }: ClinicalMathPanelProps) {
  const ownState = useClinicalMathPanelState({ defaultOpen, defaultTab });
  return <ClinicalMathPanelContent state={ownState} />;
}

function ControlledClinicalMathPanel({ state }: ClinicalMathPanelControlledProps) {
  return <ClinicalMathPanelContent state={state} />;
}

function ClinicalMathPanelContent({ state }: { state: ClinicalMathPanelState }) {
  const panelId = useId();
  const {
    open,
    setOpen,
    activeTab,
    setActiveTab,
    age,
    setAge,
    sex,
    setSex,
    weightKg,
    setWeightKg,
    heightCm,
    setHeightCm,
    creatinine,
    setCreatinine,
    creatinineUnit,
    setCreatinineUnit,
    qtMs,
    setQtMs,
    hrBpm,
    setHrBpm,
    lithiumLevel,
    setLithiumLevel,
    lithiumIndication,
    setLithiumIndication,
    currentDoseMg,
    setCurrentDoseMg,
    targetLevel,
    setTargetLevel,
    tabletIncrementMg,
    setTabletIncrementMg,
  } = state;

  const parsedAge = parseStrictNumber(age);
  const parsedWeight = parseStrictNumber(weightKg);
  const parsedHeight = heightCm.trim() === "" ? undefined : parseStrictNumber(heightCm);
  const parsedCreatinine = parseStrictNumber(creatinine);

  const cgResult = calculateCockcroftGault({
    age: parsedAge,
    weightKg: parsedWeight,
    heightCm: parsedHeight,
    sex,
    serumCreatinine: parsedCreatinine,
    creatinineUnit,
  });

  const ckdResult = calculateCkdEpi2021({
    age: parsedAge,
    sex,
    serumCreatinine: parsedCreatinine,
    creatinineUnit,
  });

  const qtcResult = calculateQtc({
    qtMs: parseStrictNumber(qtMs),
    heartRateBpm: parseStrictNumber(hrBpm),
    sex,
  });

  const parsedLithiumLevel = parseStrictNumber(lithiumLevel);
  const lithiumEval = evaluateLithiumLevel({
    serumLevelMmolL: parsedLithiumLevel,
    indication: lithiumIndication,
    age: parsedAge,
  });

  const lithiumDose = calculateProportionalLithiumDose({
    currentDoseMg: parseStrictNumber(currentDoseMg),
    currentLevelMmolL: parsedLithiumLevel,
    targetLevelMmolL: parseStrictNumber(targetLevel),
    tabletIncrementMg,
  });

  const hasRenalBaseInput = age.trim() !== "" && creatinine.trim() !== "";
  const hasWeightInput = weightKg.trim() !== "";
  const hasHeightInput = heightCm.trim() !== "";
  const renalErrors = hasRenalBaseInput
    ? hasWeightInput
      ? [...new Set([...cgResult.errors, ...ckdResult.errors])]
      : [
          ...new Set([
            ...ckdResult.errors,
            ...(hasHeightInput ? cgResult.errors.filter((err) => !err.toLowerCase().includes("weight")) : []),
          ]),
        ]
    : [];

  const hasQtcInput = qtMs.trim() !== "" && hrBpm.trim() !== "";
  const hasLithiumTroughInput = lithiumLevel.trim() !== "" && age.trim() !== "";
  const hasLithiumDoseInput = lithiumLevel.trim() !== "" && currentDoseMg.trim() !== "" && targetLevel.trim() !== "";

  return (
    <section
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e1)]"
      data-testid="clinical-math-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(eyebrowText, "flex items-center gap-1.5 text-[color:var(--text-muted)]")}>
          <Calculator className="size-icon-xs text-[color:var(--clinical-accent)]" aria-hidden="true" />
          Bedside Physiological Calculators
        </h2>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          data-testid="clinical-math-panel-toggle"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-2xs font-semibold text-[color:var(--text)]",
            focusRing,
          )}
        >
          {open ? "Hide tools" : "Open CrCl, QTc & Lithium"}
          {open ? (
            <ChevronUp className="size-icon-xs" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-icon-xs" aria-hidden="true" />
          )}
        </button>
      </div>

      {open ? (
        <div className="mt-3 grid gap-3" data-testid="clinical-math-panel-body">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Bedside physiological calculators">
            <button
              type="button"
              role="tab"
              id={`${panelId}-tab-renal`}
              aria-controls={`${panelId}-panel-renal`}
              aria-selected={activeTab === "renal"}
              data-testid="clinical-math-tab-renal"
              onClick={() => setActiveTab("renal")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                activeTab === "renal"
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
                focusRing,
              )}
            >
              <Activity className="size-icon-xs" aria-hidden="true" />
              Renal (CrCl & eGFR)
            </button>
            <button
              type="button"
              role="tab"
              id={`${panelId}-tab-qtc`}
              aria-controls={`${panelId}-panel-qtc`}
              aria-selected={activeTab === "qtc"}
              data-testid="clinical-math-tab-qtc"
              onClick={() => setActiveTab("qtc")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                activeTab === "qtc"
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
                focusRing,
              )}
            >
              <HeartPulse className="size-icon-xs" aria-hidden="true" />
              Cardiac QTc
            </button>
            <button
              type="button"
              role="tab"
              id={`${panelId}-tab-lithium`}
              aria-controls={`${panelId}-panel-lithium`}
              aria-selected={activeTab === "lithium"}
              data-testid="clinical-math-tab-lithium"
              onClick={() => setActiveTab("lithium")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                activeTab === "lithium"
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
                focusRing,
              )}
            >
              <FlaskConical className="size-icon-xs" aria-hidden="true" />
              Lithium Trough & Dose
            </button>
          </div>

          {activeTab === "renal" ? (
            <div
              role="tabpanel"
              id={`${panelId}-panel-renal`}
              aria-labelledby={`${panelId}-tab-renal`}
              className="grid gap-3"
              data-testid="clinical-math-renal-view"
            >
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Age (years)"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-age"
                />
                <TextField
                  label="Weight (kg)"
                  type="number"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-weight"
                />
                <TextField
                  label="Height (cm, optional for IBW)"
                  type="number"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="e.g. 170"
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-height"
                />
                <TextField
                  label={`Serum creatinine (${creatinineUnit})`}
                  type="number"
                  step={creatinineUnit === "mg/dL" ? "0.01" : "1"}
                  value={creatinine}
                  onChange={(e) => setCreatinine(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-creatinine"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[color:var(--text-muted)]">Sex:</span>
                  {(["male", "female"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSex(option)}
                      aria-pressed={sex === option}
                      className={cn(
                        "rounded border px-2 py-0.5 text-2xs font-semibold capitalize",
                        sex === option
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border)] text-[color:var(--text-muted)]",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[color:var(--text-muted)]">Unit:</span>
                  {(["umol/L", "mg/dL"] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => {
                        if (unit === creatinineUnit) return;
                        const current = parseStrictNumber(creatinine);
                        if (Number.isFinite(current) && current > 0) {
                          const converted =
                            unit === "mg/dL"
                              ? Math.round((current / CREATININE_UMOL_PER_MG_DL) * 100) / 100
                              : Math.round(current * CREATININE_UMOL_PER_MG_DL);
                          setCreatinine(String(converted));
                        }
                        setCreatinineUnit(unit);
                      }}
                      aria-pressed={creatinineUnit === unit}
                      className={cn(
                        "rounded border px-2 py-0.5 text-2xs font-semibold",
                        creatinineUnit === unit
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border)] text-[color:var(--text-muted)]",
                      )}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="grid gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-xs"
                data-testid="clinical-math-renal-results"
              >
                {!hasRenalBaseInput ? (
                  <p className="text-[color:var(--text-muted)]">
                    Enter patient age and serum creatinine above to calculate eGFR. Add weight for Cockcroft-Gault CrCl.
                  </p>
                ) : cgResult.isValid || ckdResult.isValid ? (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {cgResult.isValid ? (
                        <span className="font-bold text-[color:var(--text-heading)]">
                          Cockcroft-Gault CrCl: {cgResult.crClMlMin} mL/min
                        </span>
                      ) : !hasWeightInput ? (
                        <span className="text-[color:var(--text-muted)]">Enter weight to calculate CrCl</span>
                      ) : null}
                      {ckdResult.isValid ? (
                        <span className="font-mono text-2xs text-[color:var(--text-muted)]">
                          CKD-EPI 2021 eGFR: {ckdResult.egfr} mL/min/1.73m²
                        </span>
                      ) : null}
                    </div>
                    {cgResult.isValid && cgResult.ibwKg ? (
                      <p className="text-2xs text-[color:var(--text-muted)]">
                        Ideal Body Weight (Devine): {cgResult.ibwKg} kg · Weight used: {cgResult.effectiveWeightKg} kg (
                        {cgResult.weightBasis === "adjusted"
                          ? "ABW"
                          : cgResult.weightBasis === "ideal"
                            ? "IBW"
                            : "Actual"}
                        )
                      </p>
                    ) : null}
                    {cgResult.isValid && cgResult.lithiumClinicalNote ? (
                      <p
                        className="text-2xs font-medium text-[color:var(--text)]"
                        data-testid="clinical-math-renal-lithium-note"
                      >
                        {cgResult.lithiumClinicalNote}
                      </p>
                    ) : null}
                    {cgResult.warnings.map((w, idx) => (
                      <p key={idx} className={cn("rounded border px-2 py-1 text-2xs", toneWarning)}>
                        {w}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-[color:var(--text-muted)]">
                    Enter valid physiological values above to calculate renal clearance.
                  </p>
                )}
              </div>
              {renalErrors.length > 0 ? (
                <div
                  role="alert"
                  className={cn("rounded-md border p-2.5 text-xs", toneDanger)}
                  data-testid="clinical-math-renal-errors"
                >
                  {renalErrors.join(" · ")}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "qtc" ? (
            <div
              role="tabpanel"
              id={`${panelId}-panel-qtc`}
              aria-labelledby={`${panelId}-tab-qtc`}
              className="grid gap-3"
              data-testid="clinical-math-qtc-view"
            >
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Uncorrected QT (ms)"
                  type="number"
                  value={qtMs}
                  onChange={(e) => setQtMs(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-qt"
                />
                <TextField
                  label="Heart rate (bpm)"
                  type="number"
                  value={hrBpm}
                  onChange={(e) => setHrBpm(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-hr"
                />
              </div>

              <div
                className="grid gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-xs"
                data-testid="clinical-math-qtc-results"
              >
                {!hasQtcInput ? (
                  <p className="text-[color:var(--text-muted)]">
                    Enter measured QT interval and heart rate above to calculate corrected QT (QTc).
                  </p>
                ) : qtcResult.isValid ? (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold text-[color:var(--text-heading)]">
                        Fridericia QTc: {qtcResult.fridericiaMs} ms · Bazett QTc: {qtcResult.bazettMs} ms
                      </span>
                      <span className="font-mono text-2xs uppercase text-[color:var(--text-muted)]">
                        Risk: {qtcResult.riskCategory?.replace(/_/g, " ")}
                      </span>
                    </div>
                    {qtcResult.alerts.map((alert, idx) => (
                      <p key={idx} className={cn("rounded border px-2 py-1 text-2xs", toneWarning)}>
                        {alert}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-[color:var(--text-muted)]">
                    Enter valid physiological QT interval and heart rate values above to calculate corrected QT (QTc).
                  </p>
                )}
              </div>
              {hasQtcInput && !qtcResult.isValid ? (
                <div
                  role="alert"
                  className={cn("rounded-md border p-2.5 text-xs", toneDanger)}
                  data-testid="clinical-math-qtc-errors"
                >
                  {qtcResult.errors.join(" · ")}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "lithium" ? (
            <div
              role="tabpanel"
              id={`${panelId}-panel-lithium`}
              aria-labelledby={`${panelId}-tab-lithium`}
              className="grid gap-3"
              data-testid="clinical-math-lithium-view"
            >
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="12h Trough Level (mmol/L)"
                  type="number"
                  step="0.05"
                  value={lithiumLevel}
                  onChange={(e) => setLithiumLevel(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-lithium-level"
                />
                <TextField
                  label="Current Dose (mg/day)"
                  type="number"
                  step="125"
                  value={currentDoseMg}
                  onChange={(e) => setCurrentDoseMg(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-lithium-dose"
                />
                <TextField
                  label="Target Level (mmol/L)"
                  type="number"
                  step="0.05"
                  value={targetLevel}
                  onChange={(e) => setTargetLevel(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-lithium-target"
                />
                <TextField
                  label="Age (years)"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-gramm="false"
                  data-enable-grammarly="false"
                  data-testid="clinical-math-lithium-age"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[color:var(--text-muted)]">Indication:</span>
                  {(
                    [
                      ["maintenance", "Maintenance"],
                      ["acute_mania", "Acute mania"],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setLithiumIndication(val)}
                      aria-pressed={lithiumIndication === val}
                      className={cn(
                        "rounded border px-2 py-0.5 text-2xs font-semibold",
                        lithiumIndication === val
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border)] text-[color:var(--text-muted)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[color:var(--text-muted)]">Tablet step:</span>
                  {([125, 225, 250, 450] as const).map((stepMg) => (
                    <button
                      key={stepMg}
                      type="button"
                      onClick={() => setTabletIncrementMg(stepMg)}
                      aria-pressed={tabletIncrementMg === stepMg}
                      className={cn(
                        "rounded border px-2 py-0.5 text-2xs font-semibold",
                        tabletIncrementMg === stepMg
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border)] text-[color:var(--text-muted)]",
                      )}
                    >
                      {stepMg} mg
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={cn(
                  "grid gap-1.5 rounded-md border p-3 text-xs",
                  !hasLithiumTroughInput
                    ? "border-[color:var(--border)] bg-[color:var(--surface-subtle)]"
                    : lithiumEval.status === "toxic" || lithiumEval.status === "invalid"
                      ? toneDanger
                      : lithiumEval.status === "therapeutic"
                        ? toneSuccess
                        : toneWarning,
                )}
                data-testid="clinical-math-lithium-results"
              >
                {!hasLithiumTroughInput ? (
                  <p className="text-[color:var(--text-muted)]">
                    Enter current 12-hour trough level and patient age above to evaluate lithium status.
                  </p>
                ) : lithiumEval.status === "invalid" ? (
                  lithiumEval.clinicalGuidance.map((g, idx) => (
                    <p key={idx} className="text-2xs font-semibold">
                      {g}
                    </p>
                  ))
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold capitalize">
                        Level status: {lithiumEval.status} (target {lithiumEval.targetRange.min}–
                        {lithiumEval.targetRange.max} mmol/L)
                      </span>
                    </div>
                    {lithiumEval.clinicalGuidance.map((g, idx) => (
                      <p key={idx} className="text-2xs">
                        {g}
                      </p>
                    ))}
                  </>
                )}

                <div className="mt-1 border-t border-[color:var(--border)] pt-1.5">
                  {!hasLithiumDoseInput ? (
                    <p
                      className="text-2xs text-[color:var(--text-muted)]"
                      data-testid="clinical-math-lithium-suggested-dose"
                    >
                      Enter current daily dose and target level above to calculate proportional dose adjustment.
                    </p>
                  ) : lithiumDose.isValid ? (
                    <>
                      <span className="font-mono font-bold" data-testid="clinical-math-lithium-suggested-dose">
                        Suggested dose: {lithiumDose.suggestedDoseMg} mg/day
                      </span>
                      {lithiumDose.note ? (
                        <p className="mt-1 text-2xs font-medium" data-testid="clinical-math-lithium-dose-note">
                          {lithiumDose.note}
                        </p>
                      ) : null}
                      {lithiumDose.warnings?.map((w, idx) => (
                        <p key={idx} className="mt-1 text-2xs">
                          {w}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p role="alert" className="text-2xs font-semibold" data-testid="clinical-math-lithium-dose-errors">
                      {lithiumDose.errors.join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
