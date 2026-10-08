"use client";

import {
  CalendarDays,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  Palmtree,
  Plus,
  Receipt,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ExampleTag } from "@/components/example-data/example-tag";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDock,
  WorkEmpty,
  WorkHero,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { kindOf } from "@/components/roster/roster-format";
import { useRosterExtraTime } from "@/components/roster/use-roster-extra-time";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Sheet } from "@/components/ui/sheet";
import { fieldLabel } from "@/components/ui-primitives";
import { KeptWhere } from "@/components/work-sync/kept-where";
import {
  anyPatientProblem,
  PaperworkDemoNotice,
  PaperworkField,
  PaperworkFootNote,
  PaperworkOfflineNote,
  PaperworkIconButton,
  PaperworkSampleNotice,
  PaperworkStorageNote,
  PaperworkUnsavedNote,
  usePaperworkHeading,
  usePaperworkPage,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";
import {
  dropRecord,
  newPaperworkId,
  putBack,
  type AdminPaperwork,
  type PayslipCheck,
} from "@/lib/work-screens/admin/paperwork-model";
import {
  compareLine,
  formatPayHours,
  formatPayWindow,
  hoursForField,
  payrollMessage,
  payslipFromDraft,
  payslipResult,
  payslipResultWord,
  payWindows,
  rosterHoursFor,
  sortPayslips,
  validatePayslipDraft,
  type PayslipDraft,
  type PayWindow,
} from "@/lib/work-screens/admin/pay";

type RosterRead =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly retry: () => void }
  | { readonly kind: "none"; readonly why: string }
  | {
      readonly kind: "ready";
      readonly windows: readonly { window: PayWindow; rostered: number; extra: number | null }[];
      readonly anchored: boolean;
    };

/**
 * Admin · Pay (`/admin/pay`, mockup `admin_pay` and `admin_overtime`): check
 * a payslip's hours against your roster and the extra time you logged. Hours
 * only. No pay rates or award figures are shown, because PsychSift has none.
 */
export function AdminPayPage({ now: pinned }: { now?: Date } = {}) {
  usePaperworkHeading("Pay", "Payslip hours against your roster");
  const page = usePaperworkPage("admin.pay");
  const { store, online } = page;
  const say = usePaperworkSay();
  const now = useMemo(() => pinned ?? new Date(), [pinned]);
  const today = perthDateOf(now);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const shifts = useRosterShifts();
  const teams = useRosterTeams();
  const enabledTeams = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).filter((team) => team.enabled);
  const oneTeamId = enabledTeams.length === 1 ? enabledTeams[0]!.serviceId : null;
  const overview = useRosterRead(oneTeamId, "overview");
  const anchor = overview.status === "ready" ? (overview.data?.settings?.payFortnightAnchor ?? null) : null;
  const windows = payWindows(today, anchor);
  const own = shifts.status === "ready" && !shifts.sample && !page.signedOut;
  const extraNow = useRosterExtraTime(shifts.shifts, now, windows[0], own);
  const extraBefore = useRosterExtraTime(shifts.shifts, now, windows[1], own);

  const hoursShifts = useMemo(
    () => shifts.shifts.map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
    [shifts.shifts],
  );

  const roster: RosterRead = page.signedOut
    ? { kind: "none", why: "Signed in, your rostered hours fill in here from Roster." }
    : shifts.status === "loading" || shifts.teamLoading || (oneTeamId !== null && overview.status === "loading")
      ? { kind: "loading" }
      : shifts.status === "error" || shifts.status === "signed-out"
        ? { kind: "failed", retry: () => void shifts.reload() }
        : shifts.sample && !shifts.demoMode
          ? { kind: "none", why: "Roster is showing example shifts. Add your own roster and your hours fill in here." }
          : shifts.teamMessage
            ? { kind: "none", why: `${shifts.teamMessage} Your hours may be understated, so none are filled in.` }
            : {
                kind: "ready",
                anchored: Boolean(anchor),
                windows: windows.map((window, index) => {
                  const extras = index === 0 ? extraNow : extraBefore;
                  const hours = rosterHoursFor(hoursShifts, extras.records, window);
                  return {
                    window,
                    rostered: hours.rosteredHours,
                    extra: extras.status === "ready" ? hours.extraHours : null,
                  };
                }),
              };

  const record = store.state;
  const checks = useMemo(() => sortPayslips(record?.payslips ?? []), [record]);

  function change(next: (current: AdminPaperwork) => AdminPaperwork): boolean {
    const ok = store.update(next);
    setFailed(!ok);
    return ok;
  }
  // Each Undo touches its own check only, never a change made since.
  function saveCheck(check: PayslipCheck) {
    if (!change((current) => ({ ...current, payslips: [check, ...current.payslips].slice(0, 200) }))) return;
    setChecking(false);
    const result = payslipResult(check);
    say(result.matches ? "Saved. Hours match" : "Saved. The hours differ", () =>
      change((current) => ({ ...current, payslips: dropRecord(current.payslips, check.id) })),
    );
  }
  function toggleResolved(check: PayslipCheck) {
    const ok = change((current) => ({
      ...current,
      payslips: current.payslips.map((item) => (item.id === check.id ? { ...item, resolved: !item.resolved } : item)),
    }));
    if (!ok) return;
    say(check.resolved ? "Marked as not sorted" : "Marked as sorted", () =>
      change((current) => ({ ...current, payslips: putBack(current.payslips, check) })),
    );
  }
  function remove(check: PayslipCheck) {
    const index = (record?.payslips ?? []).findIndex((item) => item.id === check.id);
    if (!change((current) => ({ ...current, payslips: dropRecord(current.payslips, check.id) }))) return;
    say("Check removed", () =>
      change((current) => ({ ...current, payslips: putBack(current.payslips, check, index) })),
    );
  }
  async function copyMessage(check: PayslipCheck) {
    if (isExampleRecord(check)) {
      // With the example data switch on, its banner explains. Otherwise (the demo build) the page does.
      if (!guardExampleAction(page.examplesShown, "copy")) return;
      return say("This is an example, so nothing was copied. Sign in to check your own payslip.");
    }
    try {
      await copyTextToClipboard(payrollMessage(check));
      say("Message copied. Paste it to payroll. Nothing was sent.");
    } catch {
      say("Could not copy. Your browser blocked the clipboard. Use Email draft instead.", undefined, "warning");
    }
  }

  const latest = checks[0] ?? null;
  const latestResult = latest ? payslipResult(latest) : null;
  const current = roster.kind === "ready" ? roster.windows[0]! : null;

  return (
    <WorkBody testId="admin-pay">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">Pay</PageTitleUnderBand>
      {page.signedOut ? (
        <PaperworkSampleNotice what="payslip checks" testId="admin-pay-signed-out" examples={page.examplesShown} />
      ) : null}
      {page.demo || shifts.demoMode ? <PaperworkDemoNotice testId="admin-pay-demo" /> : null}
      {!online ? (
        <PaperworkOfflineNote testId="admin-pay-offline">
          You are offline. Your saved checks are on this phone. Roster hours fill in when you have signal, or type them
          yourself.
        </PaperworkOfflineNote>
      ) : null}
      {failed ? <PaperworkUnsavedNote testId="admin-pay-unsaved" /> : null}
      <PaperworkStorageNote store={store} testId="admin-pay-storage" />

      {roster.kind === "loading" ? (
        <ModeModuleSkeleton rows={2} twoLine eyebrow testId="admin-pay-roster-loading" />
      ) : roster.kind === "failed" ? (
        <WorkCard testId="admin-pay-roster-failed">
          <WorkEmpty
            icon={CalendarDays}
            title="Couldn't load your roster"
            body="You can still check a payslip by typing your rostered hours."
            action={
              <WorkButton variant="secondary" icon={RotateCw} onClick={roster.retry}>
                Try again
              </WorkButton>
            }
          />
        </WorkCard>
      ) : current ? (
        <WorkHero
          eyebrow={`${shifts.sample ? "Example roster · " : ""}This pay fortnight · ${formatPayWindow(current.window)}`}
          title={`${formatPayHours(current.rostered)} rostered`}
          sub={
            current.extra === null
              ? "Extra time could not be read"
              : `${formatPayHours(current.extra)} of extra time logged`
          }
          testId="admin-pay-hero"
        />
      ) : (
        <WorkCard padded testId="admin-pay-roster-none">
          <p className="text-sm">{roster.kind === "none" ? roster.why : null}</p>
        </WorkCard>
      )}
      {roster.kind === "ready" && !roster.anchored ? (
        <p className="text-xs text-[color:var(--text-muted)]" data-testid="admin-pay-no-anchor">
          Your team has no pay fortnight start set, so fortnights start on a Monday. Check the dates on your payslip.
        </p>
      ) : null}

      <WorkSectionLabel>Payslip check</WorkSectionLabel>
      {record === null ? (
        <ModeModuleSkeleton rows={2} twoLine testId="admin-pay-loading" />
      ) : latest && latestResult ? (
        <WorkCard padded testId="admin-pay-latest">
          <p className="text-xs font-semibold text-[color:var(--text-muted)]">
            {`${formatPayWindow({ start: latest.periodStart, end: latest.periodEnd })}${latest.paidOn ? ` · paid ${formatRecordedDate(latest.paidOn)}` : ""}`}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-[color:var(--text-heading)]">
            {payslipResultWord(latestResult, latest.resolved)}
            {isExampleRecord(latest) ? <ExampleTag /> : null}
          </p>
          <dl className="mt-2 grid gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Ordinary hours</dt>
              <dd className="nums font-semibold">{`${formatPayHours(latest.payslipOrdinaryHours)} of ${formatPayHours(latest.rosteredHours)}`}</dd>
            </div>
            {latest.payslipExtraHours !== undefined ? (
              <div className="flex justify-between gap-3">
                <dt>Extra hours</dt>
                <dd className="nums font-semibold">{`${formatPayHours(latest.payslipExtraHours)} of ${formatPayHours(latest.loggedExtraHours)}`}</dd>
              </div>
            ) : null}
          </dl>
          {!latestResult.matches ? (
            <div className="mt-3 grid gap-2">
              <p className="text-sm">{compareLine("Ordinary hours", latestResult.ordinary)}</p>
              {latestResult.extra ? <p className="text-sm">{compareLine("Extra hours", latestResult.extra)}</p> : null}
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                <WorkButton
                  variant="secondary"
                  icon={Copy}
                  onClick={() => void copyMessage(latest)}
                  testId="admin-pay-copy-message"
                >
                  Copy a message
                </WorkButton>
                {isExampleRecord(latest) ? null : (
                  <a
                    href={`mailto:?subject=${encodeURIComponent("Please check my pay")}&body=${encodeURIComponent(payrollMessage(latest))}`}
                    className="work-button"
                    data-variant="secondary"
                    data-testid="admin-pay-email"
                  >
                    <Mail aria-hidden="true" strokeWidth={2} />
                    Email draft
                  </a>
                )}
              </div>
            </div>
          ) : null}
        </WorkCard>
      ) : (
        <WorkCard>
          <WorkEmpty
            icon={Receipt}
            title="No payslip checked yet"
            body="Type the hours on your payslip and see if they match your roster."
            action={
              <WorkButton icon={Plus} onClick={() => setChecking(true)} testId="admin-pay-empty-check">
                Check a payslip
              </WorkButton>
            }
            testId="admin-pay-empty"
          />
        </WorkCard>
      )}

      {checks.length > 0 ? (
        <>
          <WorkSectionLabel count={checks.length}>Your checks</WorkSectionLabel>
          <WorkCard as="ul" testId="admin-pay-checks">
            {checks.map((check) => {
              const result = payslipResult(check);
              return (
                <li key={check.id} className="work-row" data-testid="admin-pay-check-row">
                  <span className="work-row__text">
                    <span className="work-row__title nums">
                      {formatPayWindow({ start: check.periodStart, end: check.periodEnd })}
                    </span>
                    <span className="work-row__sub">
                      {`${isExampleRecord(check) ? "Example · " : ""}${check.note ?? `Checked ${formatRecordedDate(check.checkedOn)}`}`}
                    </span>
                  </span>
                  {result.matches ? (
                    <WorkTag tone="neutral">Hours match</WorkTag>
                  ) : (
                    <button
                      type="button"
                      className="work-chip"
                      aria-pressed={Boolean(check.resolved)}
                      onClick={() => toggleResolved(check)}
                      data-testid="admin-pay-resolve"
                    >
                      {check.resolved ? "Sorted" : "Mark sorted"}
                    </button>
                  )}
                  <PaperworkIconButton
                    icon={Trash2}
                    label={`Remove the check for ${formatPayWindow({ start: check.periodStart, end: check.periodEnd })}`}
                    onClick={() => remove(check)}
                    testId="admin-pay-remove"
                  />
                </li>
              );
            })}
          </WorkCard>
        </>
      ) : null}

      <WorkSectionLabel>Hours and leave</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow
          icon={Clock}
          leadsTo="roster"
          title="Log extra time in Roster"
          sub="Late finishes and call-ins live there"
          href="/roster?view=hours"
        />
        <WorkIconRow
          icon={Palmtree}
          title="Leave wallet"
          sub="Leave you have planned and asked for"
          href="/admin/leave"
        />
        <WorkIconRow
          icon={Receipt}
          title="Tax"
          sub="Work expenses and tax documents"
          href={ADMIN_WORK_SCREEN_HREFS.tax}
        />
      </WorkCard>

      <WorkSectionLabel>Pay rates and allowances</WorkSectionLabel>
      <WorkCard testId="admin-pay-agreement">
        <WorkIconRow
          icon={FileText}
          title="Your agreement"
          sub="The rules PsychSift reads from it"
          href="/my-day/profile/agreement"
        />
        <a
          href={FATIGUE_RULE_SET.source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="work-row"
          data-testid="admin-pay-agreement-link"
        >
          <span className="work-row__text">
            <span className="work-row__title">{FATIGUE_RULE_SET.source.title}</span>
            <span className="work-row__sub">WA Health, health.wa.gov.au. Rates are in the agreement, not here</span>
          </span>
          <ExternalLink aria-hidden="true" className="work-row__chev" strokeWidth={2} />
          <span className="sr-only">, opens in a new tab</span>
        </a>
      </WorkCard>

      <PaperworkFootNote testId="admin-pay-footnote">
        Hours you logged, not a check of pay. PsychSift has no pay rates or award figures.{" "}
        <KeptWhere
          section="adminPaperwork"
          account="Checks are kept with your account."
          device="Checks stay on this phone."
        />
      </PaperworkFootNote>

      {record !== null ? (
        <WorkDock aria-label="Pay actions">
          <WorkButton icon={Plus} onClick={() => setChecking(true)} testId="admin-pay-check">
            Check a payslip
          </WorkButton>
        </WorkDock>
      ) : null}

      {checking ? (
        <PayslipSheet
          windows={windows}
          roster={roster.kind === "ready" ? roster.windows : null}
          today={today}
          onClose={() => setChecking(false)}
          onSave={saveCheck}
        />
      ) : null}
    </WorkBody>
  );
}

function PayslipSheet({
  windows,
  roster,
  today,
  onClose,
  onSave,
}: {
  readonly windows: readonly [PayWindow, PayWindow];
  readonly roster: readonly { window: PayWindow; rostered: number; extra: number | null }[] | null;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (check: PayslipCheck) => void;
}) {
  const filled = (index: 0 | 1) => ({
    rostered: roster ? hoursForField(roster[index]!.rostered) : "",
    logged: roster && roster[index]!.extra !== null ? hoursForField(roster[index]!.extra!) : "",
  });
  // A payslip usually arrives after its fortnight ends, so the last full fortnight comes first.
  const [draft, setDraft] = useState<PayslipDraft>(() => ({
    windowIndex: 1,
    paidOn: "",
    ordinary: "",
    extra: "",
    note: "",
    ...filled(1),
  }));
  const [tried, setTried] = useState(false);
  const errors = validatePayslipDraft(draft);
  const blocked = Object.values(errors).some(Boolean) || anyPatientProblem(draft.note);
  const set = <K extends keyof PayslipDraft>(key: K, value: PayslipDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const preview = blocked ? null : payslipResult(payslipFromDraft(draft, windows[draft.windowIndex], "preview", today));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Check a payslip"
      description="Type the hours printed on it"
      testId="admin-pay-sheet"
      footer={
        <WorkButton
          size="wide"
          onClick={() => {
            setTried(true);
            if (!blocked) onSave(payslipFromDraft(draft, windows[draft.windowIndex], newPaperworkId("pay"), today));
          }}
          testId="admin-pay-save"
        >
          Save the check
        </WorkButton>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <p className={fieldLabel}>Pay fortnight</p>
          <WorkChips label="Pay fortnight">
            {([1, 0] as const).map((index) => (
              <WorkChip
                key={index}
                selected={draft.windowIndex === index}
                onClick={() => setDraft((current) => ({ ...current, windowIndex: index, ...filled(index) }))}
                testId={`admin-pay-window-${index}`}
              >
                {`${index === 0 ? "This" : "Last"} · ${formatPayWindow(windows[index])}`}
              </WorkChip>
            ))}
          </WorkChips>
        </div>
        <PaperworkField
          label="Paid on · optional"
          type="date"
          value={draft.paidOn}
          onChange={(value) => set("paidOn", value)}
          testId="admin-pay-paid-on"
        />
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <PaperworkField
            label="Ordinary hours on payslip"
            inputMode="decimal"
            value={draft.ordinary}
            onChange={(value) => set("ordinary", value)}
            error={tried ? errors.ordinary : null}
            testId="admin-pay-ordinary"
          />
          <PaperworkField
            label="Extra hours on payslip · optional"
            inputMode="decimal"
            value={draft.extra}
            onChange={(value) => set("extra", value)}
            error={tried ? errors.extra : null}
            testId="admin-pay-extra"
          />
          <PaperworkField
            label="Rostered hours"
            inputMode="decimal"
            value={draft.rostered}
            onChange={(value) => set("rostered", value)}
            error={tried ? errors.rostered : null}
            hint={roster ? "From your roster. Change it if your roster was wrong." : "Type them from your roster."}
            testId="admin-pay-rostered"
          />
          <PaperworkField
            label="Extra time you logged"
            inputMode="decimal"
            value={draft.logged}
            onChange={(value) => set("logged", value)}
            error={tried ? errors.logged : null}
            hint={roster ? "From Roster's extra time" : undefined}
            testId="admin-pay-logged"
          />
        </div>
        <PaperworkField
          label="Note · optional"
          value={draft.note}
          onChange={(value) => set("note", value)}
          maxLength={160}
          checkPatient
          testId="admin-pay-note"
        />
        {preview ? (
          <p
            role="status"
            className="text-sm font-semibold text-[color:var(--text-heading)]"
            data-testid="admin-pay-preview"
          >
            {preview.matches
              ? "Hours match"
              : [
                  compareLine("Ordinary hours", preview.ordinary),
                  preview.extra ? compareLine("Extra hours", preview.extra) : null,
                ]
                  .filter(Boolean)
                  .join(". ")}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
