"use client";

import { Award, Check, Download, ExternalLink, Plus, Receipt, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDateRow,
  WorkDock,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldLabel } from "@/components/ui-primitives";
import {
  anyPatientProblem,
  PaperworkDemoNotice,
  PaperworkField,
  PaperworkFootNote,
  PaperworkOfflineNote,
  PaperworkIconButton,
  PaperworkSampleNotice,
  PaperworkStorageNote,
  PaperworkSwitch,
  PaperworkUnsavedNote,
  usePaperworkHeading,
  usePaperworkPage,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import { downloadTextFile } from "@/lib/admin/download-file";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { isExampleRecord, taxSample, withoutExampleRecords } from "@/lib/work-screens/admin/sample";
import { firstAdminPatientProblem } from "@/lib/work-screens/admin/patient-check";
import {
  dropRecord,
  EXPENSE_KINDS,
  newPaperworkId,
  putBack,
  type AdminExpense,
  type AdminTaxYear,
  type ExpenseKind,
} from "@/lib/work-screens/admin/paperwork-model";
import {
  ATO_LINKS,
  checklistProgress,
  emptyTaxYear,
  EXPENSE_KIND_WORDS,
  expenseLine,
  expenseTotals,
  financialYearKey,
  financialYearLabel,
  financialYearRange,
  formatCents,
  monthTotals,
  parseDollars,
  sortExpenses,
  TAX_CHECKLIST,
  taxPackCsv,
  taxPackFileName,
} from "@/lib/work-screens/admin/tax";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Admin · Tax (`/admin/tax`, mockup `admin_tax`): the doctor's work-expense
 * record and tax-document checklist for one financial year. A record for
 * them, not tax advice. No thresholds or rates: the ATO pages are linked.
 */
export function AdminTaxPage({ now: pinned }: { now?: Date } = {}) {
  const page = usePaperworkPage(taxSample);
  const { store, online } = page;
  const say = usePaperworkSay();
  const today = perthDateOf(pinned ?? new Date());
  const thisYear = financialYearKey(today);
  const lastYear = String(Number(thisYear) - 1);
  const [yearKey, setYearKey] = useState(thisYear);
  usePaperworkHeading("Tax", financialYearLabel(yearKey));
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);

  const record = store.state;
  const year: AdminTaxYear = record?.tax[yearKey] ?? emptyTaxYear();
  const expenses = useMemo(() => sortExpenses(year.expenses), [year.expenses]);
  const totals = expenseTotals(year.expenses);
  const months =
    yearKey === thisYear
      ? monthTotals(year.expenses, yearKey, today)
      : monthTotals(year.expenses, yearKey, financialYearRange(yearKey).end);
  const peak = Math.max(1, ...months.map((month) => month.cents));
  const progress = checklistProgress(year);

  function changeYear(next: (current: AdminTaxYear) => AdminTaxYear): boolean {
    const ok = store.update((current) => ({
      ...current,
      tax: { ...current.tax, [yearKey]: next(current.tax[yearKey] ?? emptyTaxYear()) },
    }));
    setFailed(!ok);
    return ok;
  }
  function tick(id: string, title: string) {
    const before = year.ticks[id] === true;
    if (!changeYear((current) => ({ ...current, ticks: { ...current.ticks, [id]: !before } }))) return;
    say(before ? `${title} not done` : `${title} done`, () =>
      changeYear((current) => ({ ...current, ticks: { ...current.ticks, [id]: before } })),
    );
  }
  // Each Undo touches its own expense only, never a change made since.
  function addExpense(expense: AdminExpense) {
    if (!changeYear((current) => ({ ...current, expenses: [expense, ...current.expenses].slice(0, 500) }))) return;
    setAdding(false);
    say(`${formatCents(expense.cents)} added`, () =>
      changeYear((current) => ({ ...current, expenses: dropRecord(current.expenses, expense.id) })),
    );
  }
  function toggleReceipt(expense: AdminExpense) {
    changeYear((current) => ({
      ...current,
      expenses: current.expenses.map((item) =>
        item.id === expense.id ? { ...item, receiptKept: !item.receiptKept } : item,
      ),
    }));
  }
  function removeExpense(expense: AdminExpense) {
    const index = year.expenses.findIndex((item) => item.id === expense.id);
    if (!changeYear((current) => ({ ...current, expenses: dropRecord(current.expenses, expense.id) }))) return;
    say(`${expense.title} removed`, () =>
      changeYear((current) => ({ ...current, expenses: putBack(current.expenses, expense, index) })),
    );
  }
  function savePack() {
    const own = withoutExampleRecords(year.expenses);
    const problem = firstAdminPatientProblem(
      own.map((expense) => expense.title),
      { allowCapitals: true },
    );
    if (problem) {
      say(
        `${problem.title} in an expense. Nothing was saved. Remove that expense and add it again.`,
        undefined,
        "warning",
      );
      return;
    }
    downloadTextFile(taxPackCsv(year, yearKey), taxPackFileName(yearKey), "text/csv;charset=utf-8");
    say("Tax pack saved. Open it in Excel or send it to your accountant");
  }

  return (
    <WorkBody testId="admin-tax">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">Tax</PageTitleUnderBand>
      {page.signedOut ? <PaperworkSampleNotice what="tax checklist" testId="admin-tax-signed-out" /> : null}
      {page.demo ? <PaperworkDemoNotice testId="admin-tax-demo" /> : null}
      {!online ? (
        <PaperworkOfflineNote testId="admin-tax-offline">
          You are offline. Your checklist and expenses are on this phone and still work. The ATO links open when you
          have signal.
        </PaperworkOfflineNote>
      ) : null}
      {failed ? <PaperworkUnsavedNote testId="admin-tax-unsaved" /> : null}
      <PaperworkStorageNote store={store} testId="admin-tax-storage" />

      <WorkChips label="Financial year">
        {[thisYear, lastYear].map((key) => (
          <WorkChip
            key={key}
            selected={yearKey === key}
            onClick={() => setYearKey(key)}
            testId={`admin-tax-year-${key}`}
          >
            {`${key} to ${String(Number(key) + 1).slice(2)}`}
          </WorkChip>
        ))}
      </WorkChips>

      {record === null ? (
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-tax-loading" />
      ) : (
        <>
          <WorkCard padded testId="admin-tax-total">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Work expenses you added
              {year.expenses.some(isExampleRecord) ? <WorkTag tone="neutral">Example figures</WorkTag> : null}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <b className="nums text-2xl font-semibold text-[color:var(--text-heading)]">
                {formatCents(totals.total)}
              </b>
              <small className="text-sm text-[color:var(--text-muted)]">
                {`${totals.count} ${totals.count === 1 ? "expense" : "expenses"}${totals.missingReceipts ? ` · ${totals.missingReceipts} without a receipt` : ""}`}
              </small>
            </p>
            {months.length > 0 && totals.count > 0 ? (
              <div className="mt-3 grid gap-1" aria-hidden="true">
                <div className="flex h-16 items-end gap-1">
                  {months.map((month) => (
                    <span
                      key={month.key}
                      className="flex-1 rounded-t-sm bg-[color:var(--mode-identity-soft-2,var(--surface-subtle))]"
                      style={{ height: `${Math.max(4, Math.round((month.cents / peak) * 100))}%` }}
                    />
                  ))}
                </div>
                <div className="flex gap-1 text-center text-xs text-[color:var(--text-muted)]">
                  {months.map((month) => (
                    <span key={month.key} className="flex-1 truncate">
                      {month.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {totals.count > 0 ? (
              <p className="sr-only">
                {months.map((month) => `${month.label} ${formatCents(month.cents)}`).join(". ")}
              </p>
            ) : null}
          </WorkCard>

          <WorkSectionLabel count={`${progress.done} of ${progress.total} done`}>Checklist</WorkSectionLabel>
          {TAX_CHECKLIST.map((group) => (
            <WorkCard
              key={group.label}
              as="ul"
              aria-label={group.label}
              testId={`admin-tax-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {group.items.map((item) => {
                const done = year.ticks[item.id] === true;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      onClick={() => tick(item.id, item.title)}
                      className={cn(focusRing, "work-row w-full text-left")}
                      data-testid={`admin-tax-tick-${item.id}`}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-full border",
                          done
                            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] text-[color:var(--surface-raised)]"
                            : "border-[color:var(--border-strong)]",
                        )}
                      >
                        {done ? <Check aria-hidden="true" className="size-icon-xs" strokeWidth={3} /> : null}
                      </span>
                      <span className="work-row__text">
                        <span className="work-row__title">{item.title}</span>
                        <span className="work-row__sub">{item.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </WorkCard>
          ))}

          <WorkSectionLabel count={expenses.length || undefined}>Expenses</WorkSectionLabel>
          {expenses.length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={Receipt}
                title="No expenses added"
                body="Add each work expense from its receipt. The totals are only what you add."
                action={
                  <WorkButton icon={Plus} onClick={() => setAdding(true)} testId="admin-tax-empty-add">
                    Add an expense
                  </WorkButton>
                }
                testId="admin-tax-empty"
              />
            </WorkCard>
          ) : (
            <WorkCard testId="admin-tax-expenses">
              {expenses.map((expense) => (
                <div key={expense.id} className="flex min-w-0 items-center" data-testid="admin-tax-expense">
                  <div className="min-w-0 flex-1">
                    <WorkDateRow
                      month={MONTHS[Number(expense.on.slice(5, 7)) - 1]!}
                      day={Number(expense.on.slice(8))}
                      title={expense.title}
                      sub={`${isExampleRecord(expense) ? "Example · " : ""}${expenseLine(expense)}`}
                      end={<b className="nums text-sm">{formatCents(expense.cents)}</b>}
                    />
                  </div>
                  <PaperworkSwitch
                    on={expense.receiptKept}
                    label={`Receipt kept for ${expense.title}`}
                    onToggle={() => toggleReceipt(expense)}
                    testId="admin-tax-receipt"
                  />
                  <PaperworkIconButton
                    icon={Trash2}
                    label={`Remove ${expense.title}`}
                    onClick={() => removeExpense(expense)}
                    testId="admin-tax-remove"
                  />
                </div>
              ))}
            </WorkCard>
          )}

          {totals.byKind.length > 0 ? (
            <WorkCard padded testId="admin-tax-by-kind">
              {year.expenses.some(isExampleRecord) ? (
                <p className="mb-2">
                  <WorkTag tone="neutral">Example figures</WorkTag>
                </p>
              ) : null}
              <dl className="grid gap-1 text-sm">
                {totals.byKind.map((row) => (
                  <div key={row.kind} className="flex justify-between gap-3">
                    <dt>{`${row.label} · ${row.count}`}</dt>
                    <dd className="nums font-semibold">{formatCents(row.cents)}</dd>
                  </div>
                ))}
              </dl>
            </WorkCard>
          ) : null}

          {withoutExampleRecords(expenses).length > 0 ? (
            <WorkButton variant="secondary" icon={Download} onClick={savePack} testId="admin-tax-download">
              Tax pack for your accountant
            </WorkButton>
          ) : null}
        </>
      )}

      <WorkSectionLabel>From the ATO</WorkSectionLabel>
      <WorkCard testId="admin-tax-ato">
        {ATO_LINKS.map((link) => (
          <a key={link.id} href={link.href} target="_blank" rel="noreferrer noopener" className="work-row">
            <span className="work-row__text">
              <span className="work-row__title">{link.title}</span>
              <span className="work-row__sub">{link.sub}</span>
            </span>
            <ExternalLink aria-hidden="true" className="work-row__chev" strokeWidth={2} />
            <span className="sr-only">, opens in a new tab</span>
          </a>
        ))}
      </WorkCard>

      <WorkCard>
        <WorkIconRow
          icon={Award}
          leadsTo="cme"
          title="Course hours are tracked in CPD"
          sub="Your learning log"
          href="/cme"
        />
        <WorkIconRow
          icon={Receipt}
          title="Pay"
          sub="Payslip hours against your roster"
          href={ADMIN_WORK_SCREEN_HREFS.pay}
        />
      </WorkCard>

      <PaperworkFootNote testId="admin-tax-footnote">
        A record for you, not tax advice. Keep your receipts as the ATO asks. This stays on this phone.
      </PaperworkFootNote>

      {record !== null ? (
        <WorkDock aria-label="Tax actions">
          <WorkButton icon={Plus} onClick={() => setAdding(true)} testId="admin-tax-add">
            Add an expense
          </WorkButton>
        </WorkDock>
      ) : null}

      {adding ? (
        <ExpenseSheet yearKey={yearKey} today={today} onClose={() => setAdding(false)} onSave={addExpense} />
      ) : null}
    </WorkBody>
  );
}

function ExpenseSheet({
  yearKey,
  today,
  onClose,
  onSave,
}: {
  readonly yearKey: string;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (expense: AdminExpense) => void;
}) {
  const range = financialYearRange(yearKey);
  const [on, setOn] = useState(today >= range.start && today <= range.end ? today : range.end);
  const [kind, setKind] = useState<ExpenseKind>("courses");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptKept, setReceiptKept] = useState(true);
  const [tried, setTried] = useState(false);
  const cents = parseDollars(amount);
  const errors = {
    title: title.trim() ? null : "Say what it was for.",
    amount: cents === null ? "Type the amount, like 146 or 146.50." : null,
    on: !on
      ? "Pick the date on the receipt."
      : on < range.start || on > range.end
        ? "That date is outside this financial year."
        : null,
  };
  const blocked = Boolean(errors.title || errors.amount || errors.on) || anyPatientProblem(title);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add an expense"
      description={financialYearLabel(yearKey)}
      testId="admin-tax-sheet"
      footer={
        <WorkButton
          size="wide"
          onClick={() => {
            setTried(true);
            if (!blocked && cents !== null)
              onSave({ id: newPaperworkId("tax"), on, kind, title: title.trim(), cents, receiptKept });
          }}
          testId="admin-tax-save"
        >
          Save
        </WorkButton>
      }
    >
      <div className="grid gap-4">
        <PaperworkField
          label="What it was for"
          value={title}
          onChange={setTitle}
          maxLength={80}
          error={tried ? errors.title : null}
          checkPatient
          testId="admin-tax-title"
        />
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <PaperworkField
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={setAmount}
            error={tried ? errors.amount : null}
            testId="admin-tax-amount"
          />
          <PaperworkField
            label="Date"
            type="date"
            value={on}
            onChange={setOn}
            min={range.start}
            max={range.end}
            error={tried ? errors.on : null}
            testId="admin-tax-date"
          />
        </div>
        <div className="grid gap-1.5">
          <p className={fieldLabel}>Kind</p>
          <WorkChips label="Kind">
            {EXPENSE_KINDS.map((option) => (
              <WorkChip
                key={option}
                selected={kind === option}
                onClick={() => setKind(option)}
                testId={`admin-tax-kind-${option}`}
              >
                {EXPENSE_KIND_WORDS[option]}
              </WorkChip>
            ))}
          </WorkChips>
        </div>
        <div className="flex min-h-12 items-center justify-between gap-3">
          <span className="text-sm font-medium">Receipt kept</span>
          <PaperworkSwitch
            on={receiptKept}
            label="Receipt kept"
            onToggle={() => setReceiptKept((value) => !value)}
            testId="admin-tax-receipt-new"
          />
        </div>
      </div>
    </Sheet>
  );
}
