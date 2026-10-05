import { AdminStatusWord } from "@/components/admin/admin-status-word";
import { focusRing } from "@/components/card-recipes";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import {
  renewNextDateLine,
  renewNextNothingDueLine,
  renewNextThenLine,
  renewWindowProgress,
  type RenewNext,
  type RenewNextItem,
} from "@/lib/admin/renew-next";

/**
 * The renewal window as one bar: from the day renewing opens to the recorded
 * date, with today marked. Decorative; the date line above says the same in words.
 */
function WindowBar({ item, today }: { readonly item: RenewNextItem; readonly today: string }) {
  const progress = renewWindowProgress(item, today);
  if (progress === null || !item.startOn) return null;
  return (
    <div className="grid gap-1" data-testid="admin-renew-next-window">
      <span aria-hidden="true" className="relative block h-2 rounded-full bg-[color:var(--surface-inset)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--text-muted)]"
          style={{ width: `${progress * 100}%` }}
        />
        <span
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[color:var(--clinical-accent)]"
          style={{ left: `${progress * 100}%` }}
        />
      </span>
      <span className={cn(textMuted, "flex justify-between gap-2 text-xs")}>
        <span>{`Start renewing ${formatRecordedDate(item.startOn)}`}</span>
        <span>{`${item.bucket === "date-passed" ? "Date passed" : "Renew by"} ${formatRecordedDate(item.row.expiresOn)}`}</span>
      </span>
    </div>
  );
}

/**
 * Renewals' top card (5 Oct mock-up v2, screen 1; screen 24 when nothing is
 * due): the one item to act on, its window, one filled button, and what comes
 * after it. The button records the renewal in the same sheet the list uses.
 */
export function RenewNextCard({
  next,
  today,
  canEdit,
  onRenew,
  onOpen,
}: {
  readonly next: RenewNext;
  readonly today: string;
  readonly canEdit: boolean;
  readonly onRenew: (item: RenewNextItem) => void;
  readonly onOpen: (item: RenewNextItem) => void;
}) {
  if (next.kind === "nothing-due") {
    return (
      <section
        aria-labelledby="admin-renew-next-heading"
        className={cn(modeModuleSurface, "grid min-w-0 gap-1 p-4")}
        data-testid="admin-renew-next-nothing-due"
      >
        <h2 id="admin-renew-next-heading" className="text-base-minus font-medium text-[color:var(--text-heading)]">
          Nothing to renew right now
        </h2>
        <p className={cn(textMuted, "text-sm")}>
          {next.next
            ? renewNextNothingDueLine(next.next)
            : "No renewal dates are recorded yet. Dates you record appear here."}
        </p>
      </section>
    );
  }

  const { item, then } = next;
  return (
    <section
      aria-labelledby="admin-renew-next-heading"
      className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-4")}
      data-testid="admin-renew-next"
    >
      <div className="grid min-w-0 gap-1">
        <p className={eyebrowText}>Renew next</p>
        <h2
          id="admin-renew-next-heading"
          className="text-lg font-semibold break-words text-[color:var(--text-heading)]"
        >
          {item.row.item.title}
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <AdminStatusWord bucket={item.bucket} testId="admin-renew-next-status" />
          <span className={cn(textMuted, "text-sm")} data-testid="admin-renew-next-date">
            {renewNextDateLine(item, today)}
          </span>
        </div>
      </div>
      <WindowBar item={item} today={today} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {canEdit ? (
          <Button variant="primary" onClick={() => onRenew(item)} testId="admin-renew-next-renewed">
            Record new date
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(item)}
          className={cn(focusRing, "min-h-12 px-1 text-sm font-medium text-[color:var(--clinical-accent)]")}
          data-testid="admin-renew-next-how"
        >
          How to renew
        </button>
      </div>
      {then ? (
        <p
          className={"border-t border-[color:var(--border)] pt-3 text-sm text-[color:var(--text)]"}
          data-testid="admin-renew-next-then"
        >
          <span className={textMuted}>Then: </span>
          {renewNextThenLine(then, today)}
        </p>
      ) : null}
    </section>
  );
}
