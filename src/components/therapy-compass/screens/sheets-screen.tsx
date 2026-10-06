"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Scale, Search } from "lucide-react";

import { InformationPageFooter, InformationPageShell } from "@/components/information-page-shell";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChoiceChip } from "@/components/ui/chip";
import { BrowserPrintButton, PrintOutput } from "@/components/ui/print-output";
import { cardSurface } from "@/components/card-recipes";
import { PageHeader } from "@/components/ui/page-header";
import { cn, ToggleSwitch } from "@/components/ui-primitives";
import { therapyRecordHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import { parseSteps, searchTherapies } from "../data/select";
import { LoadingState } from "../ui";
import { InteractiveRow, interactiveRowBase } from "@/components/ui/interactive-row";
import { TherapyRecordNavHeader } from "../therapy-record-nav-header";
import { TherapyCompareAction } from "../record/compare-action";
import { TherapySaveNotice } from "../record/save-notice";
import { useTherapyFavourite } from "../use-therapy-favourite";

export function SheetsScreen() {
  const b = useTcBindings();
  const t = b.selectedTherapy;
  const { notice, saved, toggleFavourite } = useTherapyFavourite(t?.slug ?? null);
  if (b.loading || !t) return <LoadingState label="Loading patient sheet builder…" />;

  const steps = parseSteps(t.deliverySteps, 5);
  const template = t.patientSheetTemplates[0];
  const about = t.patientExplanation || template?.body || t.clinicalSummary || "";
  const toneWord =
    b.sheetTone === "warm"
      ? "gentle, encouraging"
      : b.sheetTone === "clinical"
        ? "precise, clinical"
        : "plain, everyday";
  const sheetTitle = t.name.replace(/\s*\([^)]*\)\s*$/, "");

  return (
    <>
      <TherapyRecordNavHeader
        therapy={t}
        active="sheet"
        backHref={b.workspaceHref(therapyRecordHref(t.slug))}
        backLabel={t.name}
        testIdPrefix="therapy-sheet"
        saved={saved}
        onToggleSave={() => void toggleFavourite()}
      />
      <InformationPageShell testId="therapy-sheet-page" gap={false}>
        <section data-screen-label="Patient sheet">
          <TherapySaveNotice notice={notice} />
          {/* `data-therapy-no-print` stays on a wrapper: a bare `data-*` attribute
              cannot be passed to a component (see the `testId` note in
              `ui/button.tsx`). */}
          <div data-therapy-no-print>
            <PageHeader
              className="mb-5"
              title="Patient Sheet Builder"
              description="Design, personalise and print a plain-language handout from a source-grounded record."
              actions={<BrowserPrintButton label="Print / PDF" />}
            />
          </div>

          <div data-therapy-no-print className="mb-5">
            <TherapyCompareAction therapy={t} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[340px_minmax(0,_1fr)] gap-5 items-start">
            {/* BUILDER */}
            <div className="max-sm:static max-sm:top-auto flex flex-col gap-4 sticky top-[84px]">
              <div className={cn(cardSurface, "py-4.5 px-5")}>
                <div className="text-sm-minus font-semibold text-[color:var(--text-heading)] mb-3">Therapy</div>
                <TherapyPicker />
                <div className="text-sm-minus font-semibold text-[color:var(--text-heading)] mt-4.5 mx-0 mb-2.5">
                  Reading level &amp; tone
                </div>
                <SegmentedControl
                  label="Reading level and tone"
                  layout="equal"
                  value={b.sheetTone}
                  onChange={(value) => {
                    if (value === "warm") b.setToneWarm();
                    else if (value === "clinical") b.setToneClinical();
                    else b.setTonePlain();
                  }}
                  options={[
                    { value: "plain", label: "Plain" },
                    { value: "warm", label: "Warm" },
                    { value: "clinical", label: "Clinical" },
                  ]}
                />
              </div>

              <div className={cn(cardSurface, "py-4.5 px-5")}>
                <div className="text-sm-minus font-semibold text-[color:var(--text-heading)] mb-1.5">Sections</div>
                <p className="mt-0 mx-0 mb-3.5 text-xs text-[color:var(--text-muted)]">
                  Toggle what appears on the sheet.
                </p>
                <div className="flex flex-wrap gap-2">
                  <ChoiceChip pressed={b.secAbout} onPressedChange={b.toggleAbout}>
                    About this therapy
                  </ChoiceChip>
                  <ChoiceChip pressed={b.secSteps} onPressedChange={b.toggleSteps}>
                    Your plan
                  </ChoiceChip>
                  <ChoiceChip pressed={b.secPractice} onPressedChange={b.togglePractice}>
                    Practice at home
                  </ChoiceChip>
                  <ChoiceChip pressed={b.secCoping} onPressedChange={b.toggleCoping}>
                    If things get hard
                  </ChoiceChip>
                  <ChoiceChip pressed={b.secContacts} onPressedChange={b.toggleContacts}>
                    Support contacts
                  </ChoiceChip>
                </div>
              </div>

              <div className={cn(cardSurface, "py-4.5 px-5")}>
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm-minus font-semibold text-[color:var(--text-heading)]">
                      Clinician footer
                    </span>
                    <span className="block text-xs text-[color:var(--text-muted)] mt-0.5">
                      Name, service and review date.
                    </span>
                  </span>
                  <ToggleSwitch
                    enabled={b.sheetClinician}
                    onToggle={b.toggleClinician}
                    aria-label="Show clinician footer"
                  />
                </div>
                <p className="mt-3.5 mx-0 mb-0 text-2xs leading-normal text-[color:var(--text-muted)] border-t border-[color:var(--border)] pt-3">
                  Tip: every heading and paragraph on the sheet is editable — click to rewrite it before printing.
                  Wording follows the {toneWord} tone.
                </p>
              </div>
            </div>

            {/* PAPER */}
            <div className="flex justify-center py-2 px-0">
              <PrintOutput
                paperTone="therapy"
                provenance={`Source: ${t.name} Therapy record · Review status: ${t.reviewStatus === "reviewed" ? "reviewed" : "source review required"}`}
                className="w-full max-w-[720px] bg-[color:var(--tc-paper-background)] border border-[color:var(--tc-paper-border)] rounded-sm shadow-[var(--tc-paper-shadow)] py-13 px-14 text-[color:var(--tc-paper-ink)]"
              >
                <div className="max-sm:flex-wrap flex items-center justify-between border-b-2 border-b-[color:var(--tc-paper-accent-strong)] pb-4 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-md bg-[color:var(--tc-paper-accent-background)] text-[color:var(--tc-paper-accent)]">
                      <Scale aria-hidden="true" size={20} strokeWidth={1.6} />
                    </span>
                    <span className="text-sm-minus font-semibold text-[color:var(--tc-paper-muted)] tracking-normal">
                      Therapy · Patient information
                    </span>
                  </div>
                  <span className="text-2xs text-[color:var(--tc-paper-muted)]">Prepared for you</span>
                </div>

                <h2
                  contentEditable
                  suppressContentEditableWarning
                  className="mt-0 mx-0 mb-1.5 text-3xl-minus font-bold text-[color:var(--tc-paper-ink)] tracking-tight"
                >
                  {sheetTitle}
                </h2>
                <p
                  contentEditable
                  suppressContentEditableWarning
                  className="mt-0 mx-0 mb-6.5 text-sm text-[color:var(--tc-paper-muted)]"
                >
                  {t.bestUsedFor && t.bestUsedFor.length < 70 && !/^(most|the|a |an )/i.test(t.bestUsedFor)
                    ? `A step-by-step plan to help with ${t.bestUsedFor.toLowerCase()}.`
                    : `A plain-language plan to help you get the most from ${sheetTitle.toLowerCase()}.`}
                </p>

                {b.secAbout && about ? <PaperSection title="About this therapy">{about}</PaperSection> : null}

                {b.secSteps && steps.length ? (
                  <div className="mb-5.5">
                    <h2
                      contentEditable
                      suppressContentEditableWarning
                      className="mt-0 mx-0 mb-2.5 text-base font-semibold text-[color:var(--tc-paper-accent)]"
                    >
                      Your plan
                    </h2>
                    <div className="flex flex-col gap-2.5">
                      {steps.map((step, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="inline-flex items-center justify-center w-[24px] h-[24px] rounded-full bg-[color:var(--tc-paper-accent-background)] text-[color:var(--tc-paper-accent)] text-xs font-bold flex-none">
                            {i + 1}
                          </span>
                          <p
                            contentEditable
                            suppressContentEditableWarning
                            className="m-0 text-sm-minus leading-normal text-[color:var(--tc-paper-body)] flex-1"
                          >
                            {step}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {b.secPractice ? (
                  <div className="mb-5.5 bg-[color:var(--tc-paper-accent-background)] border border-[color:var(--tc-paper-accent-border)] rounded-md py-4 px-4.5">
                    <h2
                      contentEditable
                      suppressContentEditableWarning
                      className="mt-0 mx-0 mb-2 text-base-minus font-semibold text-[color:var(--tc-paper-accent)]"
                    >
                      Practice at home
                    </h2>
                    <p
                      contentEditable
                      suppressContentEditableWarning
                      className="m-0 text-sm-minus leading-normal text-[color:var(--tc-paper-body)]"
                    >
                      {t.homework ||
                        "Try the steps above between sessions. Note what you did and how it felt, and bring this to your next appointment."}
                    </p>
                  </div>
                ) : null}

                {b.secCoping ? (
                  <PaperSection title="If things get hard">
                    Some days will feel harder than others — that&rsquo;s normal. Make the step smaller rather than
                    skipping it. If your distress rises sharply or you have thoughts of harming yourself, use the
                    contacts below straight away.
                  </PaperSection>
                ) : null}

                {b.secContacts ? (
                  <div className="mb-2 bg-[color:var(--tc-paper-warning-background)] border border-[color:var(--tc-paper-warning-border)] rounded-md py-4 px-4.5">
                    <h2
                      contentEditable
                      suppressContentEditableWarning
                      className="mt-0 mx-0 mb-2 text-base-minus font-semibold text-[color:var(--tc-paper-warning)]"
                    >
                      Support contacts
                    </h2>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="text-sm-minus leading-normal text-[color:var(--tc-paper-body)]"
                    >
                      Your clinician: ______________________ · Phone: ______________
                      <br />
                      In a crisis, call your local emergency number or a 24/7 crisis line.
                    </div>
                  </div>
                ) : null}

                {b.sheetClinician ? (
                  <div className="flex justify-between gap-4 mt-6.5 pt-4 border-t border-[color:var(--tc-paper-border-subtle)] text-2xs text-[color:var(--tc-paper-muted)] flex-wrap">
                    <span contentEditable suppressContentEditableWarning>
                      Clinician: ____________________
                    </span>
                    <span contentEditable suppressContentEditableWarning>
                      Service: ____________________
                    </span>
                    <span contentEditable suppressContentEditableWarning>
                      Reviewed: __ / __ / ____
                    </span>
                  </div>
                ) : null}
              </PrintOutput>
            </div>
          </div>
          <div data-therapy-no-print>
            <InformationPageFooter className="mt-6">
              Patient information generated from a source-grounded record — review before sharing.
            </InformationPageFooter>
          </div>
        </section>
      </InformationPageShell>
    </>
  );
}

function PaperSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5.5">
      <h2
        contentEditable
        suppressContentEditableWarning
        className="mt-0 mx-0 mb-2 text-base font-semibold text-[color:var(--tc-paper-accent)]"
      >
        {title}
      </h2>
      <p
        contentEditable
        suppressContentEditableWarning
        className="m-0 text-sm-minus leading-normal text-[color:var(--tc-paper-body)]"
      >
        {children}
      </p>
    </div>
  );
}

function TherapyPicker() {
  const b = useTcBindings();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const base = q.trim()
      ? searchTherapies(
          b.therapies,
          { query: q, tags: [], briefOnly: false, sheetOnly: false, reviewedOnly: false },
          true,
        )
      : b.therapies;
    // Only offer therapies that actually ship a patient sheet — selecting one now
    // navigates to its /sheet subroute, which 404s for records without a sheet.
    return base.filter((x) => x.patientSheetAvailable).slice(0, 8);
  }, [q, b.therapies]);

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          interactiveRowBase,
          "flex w-full items-center justify-between py-0 px-3.5 border border-[color:var(--border-strong)] rounded-lg bg-[color:var(--surface)] text-[color:var(--text)] text-sm-minus font-semibold cursor-pointer",
        )}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Scale aria-hidden="true" className="size-icon-md text-[color:var(--clinical-accent)] flex-none" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {b.selectedTherapy?.name ?? "Choose a therapy"}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.8}
          className="size-icon-sm text-[color:var(--decoration-soft)] flex-none"
        />
      </button>
      {open ? (
        <div className="absolute z-[30] top-full mt-1 left-0 right-0 bg-[color:var(--surface)] border border-[color:var(--border)] rounded-lg shadow-[var(--shadow-hover)] overflow-hidden">
          <label className="relative flex items-center p-2 border-b border-[color:var(--border)]">
            <Search
              aria-hidden="true"
              strokeWidth={1.8}
              className="absolute left-[18px] size-icon-sm text-[color:var(--decoration-soft)]"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search therapies…"
              aria-label="Search therapies for the patient sheet"
              autoFocus
              className="w-full h-tap pt-0 pr-3 pb-0 pl-8.5 border border-[color:var(--border)] rounded-md bg-[color:var(--surface)] text-[color:var(--text)] text-sm-minus"
            />
          </label>
          <div className="max-h-[260px] overflow-auto">
            {matches.map((t) => (
              <InteractiveRow
                key={t.slug}
                variant="table-row"
                onClick={() => {
                  b.select(t.slug);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="text-sm-minus font-semibold text-[color:var(--text-heading)]">{t.name}</span>
              </InteractiveRow>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
