"use client";

import {
  Activity,
  Anchor,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCopy,
  Heart,
  Users,
  HandHelping,
  Phone,
  PhoneCall,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { NavigationBackButton } from "@/components/navigation-back-button";
import { appModeHomeHref } from "@/lib/app-modes";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import {
  cn,
  clinicalDivider,
  eyebrowText,
  fieldLabel,
  fieldControlPlain,
  metadataPill,
  panelSubtle,
  primaryControl,
  toneNeutral,
  toneSuccess,
} from "@/components/ui-primitives";

/*
 * Patient Safety Plan generator — Tools-page clinical tool.
 *
 * A clinician builds an evidence-based safety plan *with* the patient (the
 * Stanley-Brown Safety Planning Intervention, six prioritised steps), and a
 * live patient-facing preview updates as they type — ready to print, save as
 * PDF, or hand over. Working content stays in this mounted browser component;
 * the app neither stores it nor sends it to a server. Copy and print are
 * explicit user-directed exports. Plans start blank; "Load example" can demo
 * the layout with sample content that stays non-shareable until edited.
 * Australian English + AU crisis resources throughout, per the PsychSift
 * (en-AU) voice. All chrome is token-driven so light/dark, reduced-motion and
 * forced-colors follow the shared design system.
 */

// Every crisis number here is read from the one shared module (@/lib/crisis-contacts)
// rather than retyped, so a number can never drift between this tool, the Care Plan
// mockups, and any other surface that prints it. Looked up by id, not array index, so
// a later reorder of WA_CRISIS_CONTACTS cannot silently swap which number prints where.
function crisisContact(id: (typeof WA_CRISIS_CONTACTS)[number]["id"]) {
  const contact = WA_CRISIS_CONTACTS.find((candidate) => candidate.id === id);
  if (!contact) throw new Error(`missing crisis contact ${id}`);
  return contact;
}
const EMERGENCY_CONTACT = crisisContact("SYN-CRISIS-CONTACT-001");
const MHERL_METRO_CONTACT = crisisContact("SYN-CRISIS-CONTACT-002");
const MHERL_PEEL_CONTACT = crisisContact("SYN-CRISIS-CONTACT-003");
const RURALLINK_CONTACT = crisisContact("SYN-CRISIS-CONTACT-004");
const LIFELINE_CONTACT = crisisContact("SYN-CRISIS-CONTACT-005");
const SCBS_CONTACT = crisisContact("SYN-CRISIS-CONTACT-006");
const THIRTEEN_YARN_CONTACT = crisisContact("SYN-CRISIS-CONTACT-007");
const WA_REGIONAL_CRISIS_CONTACTS = [MHERL_METRO_CONTACT, MHERL_PEEL_CONTACT, RURALLINK_CONTACT];

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const softButton = cn(
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
  focusRing,
);

type StepKind = "list" | "contact";
type StepKey = "warning" | "coping" | "people" | "support" | "professional" | "environment";

type Entry = { id: string; primary: string; secondary?: string };

interface StepDef {
  key: StepKey;
  step: number;
  icon: LucideIcon;
  /** Clinician-facing card title in the builder. */
  builderTitle: string;
  /** Patient-facing, first-person title in the plan. */
  patientTitle: string;
  /** Short guidance for the clinician. */
  helper: string;
  kind: StepKind;
  primaryPlaceholder: string;
  secondaryPlaceholder?: string;
  emptyHint: string;
}

const STEPS: StepDef[] = [
  {
    key: "warning",
    step: 1,
    icon: Activity,
    builderTitle: "Warning signs",
    patientTitle: "Signs a tough time might be building",
    helper: "Thoughts, feelings, images or situations that come up before a crisis.",
    kind: "list",
    primaryPlaceholder: "e.g. Not sleeping for a couple of nights",
    emptyHint: "We’ll list these together.",
  },
  {
    key: "coping",
    step: 2,
    icon: Anchor,
    builderTitle: "Things I can do on my own",
    patientTitle: "Things I can do on my own to settle",
    helper: "Internal coping strategies — no one else needed. Grounding, movement, distraction.",
    kind: "list",
    primaryPlaceholder: "e.g. Slow breathing — 4 in, 6 out",
    emptyHint: "Add a few calming strategies.",
  },
  {
    key: "people",
    step: 3,
    icon: Users,
    builderTitle: "People & places that help me feel calm",
    patientTitle: "People and places that take my mind off things",
    helper: "Social settings and company that distract — not for asking for help yet.",
    kind: "list",
    primaryPlaceholder: "e.g. Sit in the local library",
    emptyHint: "Add people or places that help.",
  },
  {
    key: "support",
    step: 4,
    icon: HandHelping,
    builderTitle: "People I can ask for help",
    patientTitle: "People I can reach out to for support",
    helper: "Trusted people the patient would talk to when struggling. Add how to reach them.",
    kind: "contact",
    primaryPlaceholder: "Name & relationship",
    secondaryPlaceholder: "Phone or how to reach them",
    emptyHint: "Add at least one trusted person.",
  },
  {
    key: "professional",
    step: 5,
    icon: Stethoscope,
    builderTitle: "Professionals & crisis lines",
    patientTitle: "Professionals and services I can call",
    helper: "Clinician, crisis team and 24/7 lines. Confirm the numbers for your service.",
    kind: "contact",
    primaryPlaceholder: "Service or clinician",
    secondaryPlaceholder: "Phone / hours",
    emptyHint: "Add clinical contacts and a 24/7 line.",
  },
  {
    key: "environment",
    step: 6,
    icon: ShieldCheck,
    builderTitle: "Making my space safer",
    patientTitle: "Making my space safer",
    helper: "Means-safety steps — put time and distance between the patient and anything harmful.",
    kind: "list",
    primaryPlaceholder: "e.g. A friend holds my medication",
    emptyHint: "Agree practical means-safety steps.",
  },
];

/**
 * A step counts as complete when it has entries — and for the two contact steps,
 * only when every listed contact also has a reach method (the secondary field).
 * This stops a plan being finalised or shared with support/crisis contacts that
 * have a name but no phone or way to reach them in a crisis.
 */
function isStepComplete(step: StepDef, rows: Entry[]): boolean {
  if (rows.length === 0) return false;
  if (step.kind === "contact") return rows.every((row) => (row.secondary ?? "").trim() !== "");
  return true;
}

const SEED: Record<StepKey, Entry[]> = {
  warning: [
    { id: "w1", primary: "Not sleeping for a couple of nights" },
    { id: "w2", primary: "Withdrawing from friends and letting messages pile up" },
    { id: "w3", primary: "Thoughts that people would be better off without me" },
    { id: "w4", primary: "Drinking more than usual" },
  ],
  coping: [
    { id: "c1", primary: "Walk around the block with music on" },
    { id: "c2", primary: "Cold water on my face, then slow breathing (4 in, 6 out)" },
    { id: "c3", primary: "Make a cup of tea and step out into the garden" },
  ],
  people: [
    { id: "p1", primary: "Text my sister and sit with her" },
    { id: "p2", primary: "Take Biscuit to the dog park" },
    { id: "p3", primary: "Work in the local library where it’s quiet" },
  ],
  support: [
    { id: "s1", primary: "Priya — my sister", secondary: "0400 000 000" },
    { id: "s2", primary: "Jordan — close friend", secondary: "0400 111 222" },
  ],
  professional: [
    { id: "pr1", primary: "Dr Nguyen — GP", secondary: "Rosewood Clinic · (02) 0000 0000" },
    { id: "pr2", primary: "Community mental health crisis team", secondary: "1800 000 000 · 24/7" },
    { id: "pr3", primary: "Lifeline", secondary: "13 11 14 · 24/7" },
  ],
  environment: [
    { id: "e1", primary: "Priya keeps my medication and hands it out weekly" },
    { id: "e2", primary: "Leave anything I could misuse with a mate for now" },
    { id: "e3", primary: "Skip alcohol on the days I’m feeling low" },
  ],
};

const SEED_REASONS: Entry[] = [
  { id: "r1", primary: "My dog, Biscuit" },
  { id: "r2", primary: "Finishing my apprenticeship" },
  { id: "r3", primary: "The camping trip with mates in spring" },
  { id: "r4", primary: "Being there for my niece" },
];

// Production default: a fresh plan starts blank so no sample/placeholder content
// (including the non-working example crisis numbers) can reach a printed handover.
// "Load example" restores SEED for demos/training but keeps the plan non-shareable
// (example watermark, Finalise disabled) until every seeded row is removed/replaced.
const EMPTY_ENTRIES: Record<StepKey, Entry[]> = {
  warning: [],
  coping: [],
  people: [],
  support: [],
  professional: [],
  environment: [],
};

const SAFETY_PLAN_STORAGE_KEY = "psychsift:draft:patient-safety-plan";

const SEED_ENTRY_IDS = new Set([
  ...Object.values(SEED).flatMap((rows) => rows.map((entry) => entry.id)),
  ...SEED_REASONS.map((entry) => entry.id),
]);

function planContainsSeedEntries(entries: Record<StepKey, Entry[]>, reasons: Entry[]): boolean {
  for (const rows of Object.values(entries)) {
    for (const entry of rows) {
      if (SEED_ENTRY_IDS.has(entry.id)) return true;
    }
  }
  return reasons.some((entry) => SEED_ENTRY_IDS.has(entry.id));
}

/* ---------- small building blocks ---------- */

function AddRow({
  kind,
  namePrefix,
  primaryPlaceholder,
  secondaryPlaceholder,
  onAdd,
  onDraftDirtyChange,
}: {
  kind: StepKind;
  namePrefix?: string;
  primaryPlaceholder: string;
  secondaryPlaceholder?: string;
  onAdd: (primary: string, secondary?: string) => void;
  onDraftDirtyChange?: (dirty: boolean) => void;
}) {
  const autoId = useId();
  const primaryId = namePrefix ? `spg-${namePrefix}-primary` : `spg-primary-${autoId}`;
  const secondaryId = namePrefix ? `spg-${namePrefix}-secondary` : `spg-secondary-${autoId}`;
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const draftIsDirty = useCallback(
    (nextPrimary: string, nextSecondary: string) => nextPrimary.trim() !== "" || nextSecondary.trim() !== "",
    [],
  );

  const submit = () => {
    const trimmed = primary.trim();
    if (!trimmed) return;
    onAdd(trimmed, secondary.trim() || undefined);
    setPrimary("");
    setSecondary("");
    onDraftDirtyChange?.(false);
  };

  return (
    <div className={cn("grid gap-2", kind === "contact" && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]")}>
      <input
        id={primaryId}
        name={primaryId}
        value={primary}
        onChange={(event) => {
          const nextPrimary = event.target.value;
          setPrimary(nextPrimary);
          onDraftDirtyChange?.(draftIsDirty(nextPrimary, secondary));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={primaryPlaceholder}
        aria-label={primaryPlaceholder}
        className={cn(fieldControlPlain, "min-h-tap")}
      />
      {kind === "contact" ? (
        <input
          id={secondaryId}
          name={secondaryId}
          value={secondary}
          onChange={(event) => {
            const nextSecondary = event.target.value;
            setSecondary(nextSecondary);
            onDraftDirtyChange?.(draftIsDirty(primary, nextSecondary));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={secondaryPlaceholder}
          aria-label={secondaryPlaceholder}
          className={cn(fieldControlPlain, "min-h-tap")}
        />
      ) : null}
      <button
        type="button"
        onClick={submit}
        className={cn(
          "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)]",
          kind === "list" && "justify-self-start",
          focusRing,
        )}
      >
        <Plus className="size-icon-sm" aria-hidden="true" />
        Add
      </button>
    </div>
  );
}

function EntryChip({ entry, kind, onRemove }: { entry: Entry; kind: StepKind; onRemove: () => void }) {
  return (
    <li
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 shadow-[var(--shadow-inset)]",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">{entry.primary}</p>
        {kind === "contact" && entry.secondary ? (
          <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-2xs font-bold tabular-nums text-[color:var(--clinical-accent)]">
            <Phone className="size-icon-xs" aria-hidden="true" />
            {entry.secondary}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove “${entry.primary}”`}
        className={cn(
          "relative grid size-7 place-items-center rounded-md text-[color:var(--decoration-soft)] transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] before:absolute before:-inset-2.5 before:content-['']",
          focusRing,
        )}
      >
        <X className="size-icon-sm" aria-hidden="true" />
      </button>
    </li>
  );
}

function StepBuilderCard({
  def,
  entries,
  onAdd,
  onRemove,
  onDraftDirtyChange,
}: {
  def: StepDef;
  entries: Entry[];
  onAdd: (primary: string, secondary?: string) => void;
  onRemove: (id: string) => void;
  onDraftDirtyChange: (dirty: boolean) => void;
}) {
  const Icon = def.icon;
  const filled = isStepComplete(def, entries);

  return (
    <section
      className={cn(panelSubtle, "grid content-start gap-3 p-4")}
      aria-label={`Step ${def.step}: ${def.builderTitle}`}
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Icon className="size-icon-md" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs font-bold tabular-nums text-[color:var(--text-muted)]">
              Step {def.step}
            </span>
            {filled ? (
              <span
                className={cn(
                  "inline-flex size-4 place-items-center items-center justify-center rounded-full text-[color:var(--success)]",
                )}
                aria-hidden="true"
              >
                <CheckCheck className="size-icon-xs" aria-hidden="true" />
              </span>
            ) : null}
          </div>
          <h3 className="text-sm font-extrabold leading-5 text-[color:var(--text-heading)]">{def.builderTitle}</h3>
          <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">{def.helper}</p>
        </div>
        <span className={cn(metadataPill, "shrink-0 tabular-nums")}>{entries.length}</span>
      </header>

      {entries.length ? (
        <ul className="grid gap-1.5">
          {entries.map((entry) => (
            <EntryChip key={entry.id} entry={entry} kind={def.kind} onRemove={() => onRemove(entry.id)} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] px-3 py-2 text-2xs font-semibold text-[color:var(--text-muted)]">
          {def.emptyHint}
        </p>
      )}

      <AddRow
        kind={def.kind}
        namePrefix={def.key}
        primaryPlaceholder={def.primaryPlaceholder}
        secondaryPlaceholder={def.secondaryPlaceholder}
        onAdd={onAdd}
        onDraftDirtyChange={onDraftDirtyChange}
      />
    </section>
  );
}

/* ---------- patient-facing preview ---------- */

function PreviewStep({ def, entries }: { def: StepDef; entries: Entry[] }) {
  const Icon = def.icon;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] font-mono text-sm font-extrabold tabular-nums text-[color:var(--clinical-accent)]">
        {def.step}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
          <h3 className="text-sm-minus font-extrabold leading-5 text-[color:var(--text-heading)]">
            {def.patientTitle}
          </h3>
        </div>
        {entries.length ? (
          <ul className="mt-1.5 grid gap-1">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-sm-minus leading-5 text-[color:var(--text)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]"
                />
                <span className="min-w-0 font-medium">
                  {entry.primary}
                  {def.kind === "contact" && entry.secondary ? (
                    <span className="ml-1.5 font-mono text-2xs font-bold tabular-nums text-[color:var(--clinical-accent)]">
                      {entry.secondary}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-2xs font-semibold italic leading-4 text-[color:var(--text-muted)]">
            To be completed together.
          </p>
        )}
      </div>
    </li>
  );
}

/* ---------- root ---------- */

export function PatientSafetyPlan() {
  const [entries, setEntries] = useState<Record<StepKey, Entry[]>>(EMPTY_ENTRIES);
  const [reasons, setReasons] = useState<Entry[]>([]);
  const [planDate, setPlanDate] = useState("");
  const [mobileTab, setMobileTab] = useState<"build" | "preview">("build");
  const [copied, setCopied] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const [draftDirtyByRow, setDraftDirtyByRow] = useState<Record<string, boolean>>({});
  // Per-instance id counter — avoids a module-level mutable that would persist
  // across remounts; ids only need to be unique within this mounted plan.
  const uidRef = useRef(0);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const uid = useCallback((prefix: string) => `${prefix}-live-${uidRef.current++}`, []);

  // Clear the copy-feedback timer on unmount so jsdom teardown / remount cannot
  // fire setState after the environment tears down (`window is not defined`).
  // Also flip mountedRef so a late clipboard await cannot schedule feedback.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedResetRef.current != null) {
        clearTimeout(copiedResetRef.current);
        copiedResetRef.current = null;
      }
    };
  }, []);

  // Restore draft from sessionStorage on mount (DEF-008)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.sessionStorage.getItem(SAFETY_PLAN_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        queueMicrotask(() => {
          if (parsed.entries && typeof parsed.entries === "object") {
            setEntries(parsed.entries);
          }
          if (Array.isArray(parsed.reasons)) {
            setReasons(parsed.reasons);
          }
          if (typeof parsed.planDate === "string") {
            setPlanDate(parsed.planDate);
          }
        });
      }
    } catch {
      /* ignore storage read error */
    }
  }, []);

  const addEntry = useCallback(
    (key: StepKey, primary: string, secondary?: string) => {
      setEntries((prev) => ({ ...prev, [key]: [...prev[key], { id: uid(key), primary, secondary }] }));
      setFinalised(false);
    },
    [uid],
  );

  const removeEntry = useCallback((key: StepKey, id: string) => {
    setEntries((prev) => ({ ...prev, [key]: prev[key].filter((entry) => entry.id !== id) }));
    setFinalised(false);
  }, []);

  const setDraftDirty = useCallback((key: string, dirty: boolean) => {
    setDraftDirtyByRow((prev) => {
      if (prev[key] === dirty) return prev;
      return { ...prev, [key]: dirty };
    });
  }, []);

  const filledSteps = useMemo(() => STEPS.filter((step) => isStepComplete(step, entries[step.key])).length, [entries]);
  // SEED includes non-working crisis numbers. Stay in example mode while any
  // seeded row remains so a date-only edit cannot make fake contacts printable.
  const exampleActive = planContainsSeedEntries(entries, reasons);
  const stepsComplete = filledSteps === STEPS.length;
  const ready = stepsComplete && !exampleActive;
  // Working plan content is browser-tab only and never persisted. Treat any
  // entered step/reason/date as dirty so the header back control cannot discard
  // an in-progress plan without an explicit confirmation.
  const isDirty = useMemo(
    () =>
      Object.values(entries).some((rows) => rows.length > 0) ||
      reasons.length > 0 ||
      planDate.trim() !== "" ||
      Object.values(draftDirtyByRow).some(Boolean),
    [draftDirtyByRow, entries, planDate, reasons],
  );

  // The back control asks before discarding, but closing the tab, refreshing or
  // a swipe-back did not (ledger #846DP9). Ask the browser to confirm too. The
  // plan is still never written anywhere: this only prompts before it is lost.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // Continuous sessionStorage draft caching for crash / reload recovery (DEF-008)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!isDirty || planContainsSeedEntries(entries, reasons)) {
        return;
      }
      const draft = { entries, reasons, planDate };
      window.sessionStorage.setItem(SAFETY_PLAN_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* ignore quota or privacy errors */
    }
  }, [entries, isDirty, planDate, reasons]);

  const planText = useMemo(() => {
    const guardLines = exampleActive
      ? ["*** EXAMPLE — SAMPLE SAFETY PLAN WITH NON-WORKING NUMBERS, NOT FOR PATIENT HANDOVER ***", ""]
      : ready
        ? []
        : ["*** DRAFT — INCOMPLETE SAFETY PLAN, NOT FOR PATIENT HANDOVER ***", ""];
    const lines: string[] = [
      ...guardLines,
      "MY SAFETY PLAN",
      "Name (add after export): ____________________",
      planDate ? `Date: ${planDate}` : "",
      "",
    ];
    for (const step of STEPS) {
      lines.push(`${step.step}. ${step.patientTitle}`);
      const rows = entries[step.key];
      if (rows.length) {
        for (const row of rows) lines.push(`   • ${row.primary}${row.secondary ? ` — ${row.secondary}` : ""}`);
      } else {
        lines.push("   • (to be completed)");
      }
      lines.push("");
    }
    if (reasons.length) {
      lines.push("MY REASONS FOR LIVING");
      for (const reason of reasons) lines.push(`   • ${reason.primary}`);
      lines.push("");
    }
    lines.push(
      `In an emergency: call ${EMERGENCY_CONTACT.telephoneDisplay} or go to your nearest Emergency Department.`,
    );
    lines.push(
      `24/7 support: ${LIFELINE_CONTACT.name} ${LIFELINE_CONTACT.telephoneDisplay} · ${SCBS_CONTACT.name} ${SCBS_CONTACT.telephoneDisplay} · ${THIRTEEN_YARN_CONTACT.name} ${THIRTEEN_YARN_CONTACT.telephoneDisplay}.`,
    );
    lines.push("Western Australia crisis lines:");
    for (const contact of WA_REGIONAL_CRISIS_CONTACTS) {
      lines.push(`   • ${contact.name} — ${contact.telephoneDisplay} (${contact.availability})`);
      // A crisis number and its stated limitation (e.g. "not an emergency service") must
      // never be separated — see care-plan.module.css's .crisisEntry print-break comment.
      if (contact.caveat !== null) lines.push(`     ${contact.caveat}`);
    }
    return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
  }, [entries, exampleActive, planDate, ready, reasons]);

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(planText);
      if (!mountedRef.current) return;
      setCopied(true);
      if (copiedResetRef.current != null) clearTimeout(copiedResetRef.current);
      copiedResetRef.current = setTimeout(() => {
        copiedResetRef.current = null;
        if (!mountedRef.current) return;
        setCopied(false);
      }, 1600);
    } catch {
      /* clipboard unavailable in some embeds — safe no-op */
    }
  };

  const printPlan = () => {
    if (typeof window !== "undefined") window.print();
  };

  const loadExample = () => {
    const hasContent =
      Object.values(entries).some((rows) => rows.length > 0) || reasons.length > 0 || planDate.trim() !== "";
    if (hasContent && !window.confirm("Replace the current plan with the example content?")) return;
    setEntries(SEED);
    setReasons(SEED_REASONS);
    // Clear the plan date so example content cannot look like a current handover.
    setPlanDate("");
    setFinalised(false);
  };

  const clearAll = () => {
    setEntries(EMPTY_ENTRIES);
    setReasons([]);
    setPlanDate("");
    setFinalised(false);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(SAFETY_PLAN_STORAGE_KEY);
      }
    } catch {
      /* ignore storage removal error */
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "safety-plan-tool min-w-0 bg-[color:var(--background)] text-[color:var(--text)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]",
      )}
    >
      {/*
        Safety plan sits outside the search shell, so this header owns the OS top
        inset via max(safe-area-top) — same contract as /privacy and colour-coding.
        Avoid axis py-* here so it cannot fight the side-specific pt-* pad.
      */}
      <header
        data-testid="safety-plan-tool-header"
        className="border-b border-[color:var(--border)] bg-[color:var(--surface)] pt-[max(0.75rem,var(--safe-area-top))] sm:pt-[max(1.25rem,var(--safe-area-top))]"
      >
        <div className="mx-auto grid max-w-7xl gap-4 px-4 pb-4 pt-3 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-8">
          {/*
            Phone: back on its own min-h-tap row, then shield + title.
            lg+: lg:contents folds back/shield/title into one three-column row.
          */}
          <div className="grid gap-3 lg:grid-cols-[auto_auto_minmax(0,1fr)] lg:items-start lg:gap-3">
            <div className="flex min-h-tap items-center lg:contents">
              <NavigationBackButton
                className="size-tap"
                fallbackHref={appModeHomeHref("tools")}
                onBeforeNavigate={() => {
                  if (!isDirty) return true;
                  return window.confirm(
                    "Leave this safety plan? Your entries are only in this browser tab and will be lost.",
                  );
                }}
              />
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 lg:contents">
              <span className="grid size-tap shrink-0 place-items-center rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
                <ShieldCheck className="size-icon-lg" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className={eyebrowText}>PsychSift · Clinical tool</p>
                <h1 className="mt-0.5 text-2xl-minus font-extrabold leading-tight text-[color:var(--text-heading)]">
                  Safety plan generator
                </h1>
                <p className="mt-1 max-w-xl text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
                  Build an identifier-free safety plan <em>with</em> your patient — the six prioritised steps — then
                  export it through your approved clinical workflow.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div className="grid gap-1">
              <span className={cn(eyebrowText, "leading-none")}>Plan progress</span>
              <div className="flex items-center gap-2">
                <div className="flex gap-1" role="img" aria-label={`${filledSteps} of ${STEPS.length} steps complete`}>
                  {STEPS.map((step) => (
                    <span
                      key={step.key}
                      className={cn(
                        "h-1.5 w-6 rounded-full transition-colors",
                        isStepComplete(step, entries[step.key])
                          ? "bg-[color:var(--clinical-accent)]"
                          : "bg-[color:var(--surface-inset)] ring-1 ring-inset ring-[color:var(--border)]",
                      )}
                    />
                  ))}
                </div>
                <span
                  className={cn(
                    "inline-flex min-h-6 items-center gap-1 rounded-md border px-2 text-2xs font-bold",
                    ready ? toneSuccess : toneNeutral,
                  )}
                >
                  {ready
                    ? "Ready to share"
                    : exampleActive
                      ? "Example — not for handover"
                      : `${filledSteps}/${STEPS.length} steps`}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFinalised(true)}
              disabled={!ready}
              className={cn(primaryControl, "min-h-tap")}
            >
              {finalised ? (
                <Check className="size-icon-md" aria-hidden="true" />
              ) : (
                <Sparkles className="size-icon-md" aria-hidden="true" />
              )}
              {finalised ? "Plan finalised" : "Finalise plan"}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile pane switch */}
      <div data-print-hide className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:hidden">
        <div
          role="tablist"
          aria-label="Safety plan view"
          className="grid grid-cols-2 gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-1"
        >
          {(["build", "preview"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              id={`spg-tab-${tab}`}
              aria-selected={mobileTab === tab}
              aria-controls={`spg-panel-${tab}`}
              onClick={() => setMobileTab(tab)}
              className={cn(
                "min-h-tap rounded-md px-3 text-sm-minus font-bold transition",
                mobileTab === tab
                  ? "bg-[color:var(--surface)] text-[color:var(--text-heading)] shadow-[var(--e1)]"
                  : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                focusRing,
              )}
            >
              {tab === "build" ? "Build" : "Plan preview"}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-2 lg:items-start lg:px-8">
        {/* ---------- Builder ---------- */}
        <div
          id="spg-panel-build"
          data-print-hide
          role="tabpanel"
          aria-labelledby="spg-tab-build"
          className={cn("min-w-0 grid content-start gap-4", mobileTab === "build" ? "grid" : "hidden", "lg:grid")}
        >
          {/* At 390px the heading and both buttons each wrapped onto two lines;
              let the row wrap as whole items and keep every label on one line. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="whitespace-nowrap text-sm font-extrabold uppercase tracking-label text-[color:var(--text-muted)]">
              Build the plan
            </h2>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <button type="button" onClick={loadExample} className={softButton}>
                <Sparkles className="size-icon-sm" aria-hidden="true" />
                Load example
              </button>
              <button type="button" onClick={clearAll} className={softButton}>
                <RotateCcw className="size-icon-sm" aria-hidden="true" />
                Clear all
              </button>
            </div>
          </div>

          {/* Local-only working boundary */}
          <section className={cn(panelSubtle, "grid gap-3 p-4")} aria-label="Safety plan privacy">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
              <ShieldCheck className="mt-0.5 size-icon-md text-[color:var(--clinical-accent)]" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">
                  Keep this plan identifier-free
                </h2>
                <p className="mt-1 text-2xs font-medium leading-5 text-[color:var(--text-muted)]">
                  Do not enter the patient&apos;s name, date of birth, or record number. Enter only the minimum plan
                  details and support contacts needed. Working content is kept only in this browser tab; PsychSift does
                  not save it or send it to a server.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="spg-date" className={fieldLabel}>
                Plan date (optional)
              </label>
              <input
                id="spg-date"
                name="planDate"
                value={planDate}
                onChange={(event) => {
                  setPlanDate(event.target.value);
                  setFinalised(false);
                }}
                placeholder="e.g. 12 Aug 2026"
                className={fieldControlPlain}
              />
            </div>
          </section>

          {STEPS.map((def) => (
            <StepBuilderCard
              key={def.key}
              def={def}
              entries={entries[def.key]}
              onAdd={(primary, secondary) => addEntry(def.key, primary, secondary)}
              onRemove={(id) => removeEntry(def.key, id)}
              onDraftDirtyChange={(dirty) => setDraftDirty(def.key, dirty)}
            />
          ))}

          {/* Reasons for living */}
          <section
            className="grid content-start gap-3 rounded-lg border border-[color:var(--clinical-chat-sand-border)] bg-[color:var(--clinical-chat-sand)] p-4"
            aria-label="Reasons for living"
          >
            <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-chat-sand-border-strong)] bg-[color:var(--surface)] text-[color:var(--warning)]">
                <Heart className="size-icon-md" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold leading-5 text-[color:var(--text-heading)]">
                  Reasons for living
                </h3>
                <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                  The people, plans and things that matter — worth coming back to.
                </p>
              </div>
              <span className={cn(metadataPill, "shrink-0 tabular-nums")}>{reasons.length}</span>
            </header>
            {reasons.length ? (
              <ul className="flex flex-wrap gap-x-2.5 gap-y-2">
                {reasons.map((reason) => (
                  <li
                    key={reason.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--clinical-chat-sand-border-strong)] bg-[color:var(--surface)] py-1 pl-3 pr-1.5 text-sm-minus font-semibold text-[color:var(--text-heading)]"
                  >
                    {reason.primary}
                    <button
                      type="button"
                      onClick={() => {
                        setReasons((prev) => prev.filter((item) => item.id !== reason.id));
                        setFinalised(false);
                      }}
                      aria-label={`Remove “${reason.primary}”`}
                      className={cn(
                        "relative grid size-5 place-items-center rounded-full text-[color:var(--decoration-soft)] transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] before:absolute before:-inset-y-3.5 before:-inset-x-3 before:content-['']",
                        focusRing,
                      )}
                    >
                      <X className="size-icon-xs" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <AddRow
              kind="list"
              namePrefix="reasons"
              primaryPlaceholder="e.g. Finishing my apprenticeship"
              onDraftDirtyChange={(dirty) => setDraftDirty("reason", dirty)}
              onAdd={(primary) => {
                setReasons((prev) => [...prev, { id: uid("reason"), primary }]);
                setDraftDirty("reason", false);
                setFinalised(false);
              }}
            />
          </section>
        </div>

        {/* ---------- Preview ---------- */}
        <div
          id="spg-panel-preview"
          data-safety-plan-copy
          role="tabpanel"
          aria-labelledby="spg-tab-preview"
          className={cn(
            "min-w-0",
            mobileTab === "preview" ? "block" : "hidden",
            "lg:block lg:sticky lg:top-6 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1",
          )}
        >
          {/* Preview toolbar */}
          <div data-print-hide className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold uppercase tracking-label text-[color:var(--text-muted)]">
              Patient copy
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={copyPlan} className={softButton}>
                {copied ? (
                  <CheckCheck className="size-icon-sm text-[color:var(--success)]" aria-hidden="true" />
                ) : (
                  <ClipboardCopy className="size-icon-sm" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={printPlan} className={softButton}>
                <Printer className="size-icon-sm" aria-hidden="true" />
                Print / PDF
              </button>
            </div>
          </div>

          <p
            data-print-hide
            className="mb-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-2xs font-semibold leading-5 text-[color:var(--text-muted)]"
          >
            Copying, printing, or saving a PDF moves the plan outside PsychSift. Add any patient identifier only after
            export, using your organisation&apos;s approved clinical record and handling process.
          </p>

          {finalised ? (
            <div
              role="status"
              data-print-hide
              className={cn(
                "mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm-minus font-bold",
                toneSuccess,
              )}
            >
              <Check className="size-icon-md shrink-0" aria-hidden="true" />
              Plan finalised — print it or hand a copy to your patient before they leave.
            </div>
          ) : null}

          {/* The plan document */}
          <article className="grid content-start gap-5 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-5 shadow-[var(--e4)] sm:p-6">
            {exampleActive ? (
              <p
                role="note"
                className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm-minus font-bold leading-5 text-[color:var(--warning)]"
              >
                Example only — this sample plan uses non-working contact numbers. Replace every entry with the
                patient&apos;s real details before sharing or printing.
              </p>
            ) : ready ? null : (
              <p
                role="note"
                className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm-minus font-bold leading-5 text-[color:var(--warning)]"
              >
                Draft — this plan is incomplete. Finish every step, and give each contact a way to reach them, before
                giving it to a patient.
              </p>
            )}
            <header className="grid gap-2 border-b border-[color:var(--border)] pb-4">
              <div className="flex items-center gap-2 text-[color:var(--clinical-accent)]">
                <Heart className="size-icon-md" aria-hidden="true" />
                <span className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>My safety plan</span>
              </div>
              <h2 className="text-2xl-minus font-extrabold leading-tight text-[color:var(--text-heading)]">
                Keeping myself safe
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs font-semibold tabular-nums text-[color:var(--text-muted)]">
                <span>Name (add after printing): ________________</span>
                <span>{planDate ? planDate : "Date: ____________"}</span>
              </div>
              <p className="mt-1 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
                When things get hard or I’m having thoughts of suicide, I’ll work through these steps in order. I can
                start anywhere — even one step can help.
              </p>
            </header>

            <ol className="grid gap-4">
              {STEPS.map((def) => (
                <PreviewStep key={def.key} def={def} entries={entries[def.key]} />
              ))}
            </ol>

            {reasons.length ? (
              <div className="grid gap-2 rounded-lg border border-[color:var(--clinical-chat-sand-border)] bg-[color:var(--clinical-chat-sand)] p-4">
                <div className="flex items-center gap-1.5 text-[color:var(--warning)]">
                  <Heart className="size-icon-sm" aria-hidden="true" />
                  <span className={cn(eyebrowText, "text-[color:var(--warning)]")}>My reasons for living</span>
                </div>
                <p className="text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                  {reasons.map((reason) => reason.primary).join(" · ")}
                </p>
              </div>
            ) : null}

            {/* Emergency escalation */}
            <div className="grid gap-3 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-4">
              <div className="flex items-center gap-1.5 text-[color:var(--clinical-accent-hover)]">
                <PhoneCall className="size-icon-sm" aria-hidden="true" />
                <span className={cn(eyebrowText, "text-[color:var(--clinical-accent-hover)]")}>
                  If I’m not safe right now
                </span>
              </div>
              <a
                href={`tel:${EMERGENCY_CONTACT.telephoneUri}`}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-[color:var(--clinical-accent)] px-4 py-3 text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--clinical-accent-hover)]",
                  focusRing,
                )}
              >
                <Phone className="size-icon-lg" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-lg-minus font-extrabold leading-tight">
                    Call {EMERGENCY_CONTACT.telephoneDisplay}
                  </span>
                  <span className="block text-2xs font-semibold opacity-90">
                    or go to my nearest Emergency Department
                  </span>
                </span>
              </a>
              <p className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-sm-minus font-semibold text-[color:var(--text-heading)]">
                <PhoneCall className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
                <span>
                  24/7 support —{" "}
                  <span className="font-extrabold">
                    {LIFELINE_CONTACT.name} {LIFELINE_CONTACT.telephoneDisplay}
                  </span>{" "}
                  · {SCBS_CONTACT.name} {SCBS_CONTACT.telephoneDisplay} · {THIRTEEN_YARN_CONTACT.name}{" "}
                  {THIRTEEN_YARN_CONTACT.telephoneDisplay}
                </span>
              </p>
              <ul className="grid gap-1 pl-6 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                {WA_REGIONAL_CRISIS_CONTACTS.map((contact) => (
                  <li key={contact.id}>
                    <span>
                      {contact.name} — {contact.telephoneDisplay} ({contact.availability})
                    </span>
                    {/* A crisis number and its stated limitation must never be separated —
                        see care-plan.module.css's .crisisEntry print-break comment. */}
                    {contact.caveat === null ? null : <span className="block">{contact.caveat}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <footer className={cn("grid gap-1 pt-1", clinicalDivider, "border-t pt-3")}>
              <p className="font-mono text-3xs font-semibold leading-4 text-[color:var(--text-muted)]">
                Based on the Stanley–Brown Safety Planning Intervention (Stanley &amp; Brown, 2012).
              </p>
              <p className="text-3xs font-medium leading-4 text-[color:var(--text-muted)]">
                A supportive plan built collaboratively — not a substitute for clinical risk assessment. Confirm crisis
                numbers for your local service.
              </p>
            </footer>
          </article>

          <p
            data-print-hide
            className="mt-3 flex items-center gap-1.5 px-1 text-2xs font-semibold text-[color:var(--text-muted)]"
          >
            <ChevronRight className="size-icon-xs text-[color:var(--clinical-accent)]" aria-hidden="true" />
            Confirm every contact and crisis number before export, then handle the copy under your approved clinical
            record process.
          </p>
        </div>
      </div>
    </main>
  );
}
