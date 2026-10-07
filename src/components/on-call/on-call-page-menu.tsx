"use client";

import { BriefcaseMedical, Calendar, Check, Ellipsis, Lock, Plus, Printer, Tag } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { ON_CALL_VIEW_TITLES, type OnCallPageView } from "@/components/on-call/on-call-section-identity";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { type OnCallContactsOrder } from "@/components/on-call/on-call-contacts-section";
import { ON_CALL_HOME_TAGS } from "@/lib/on-call/home-modules";

/**
 * The page menu's rows, without a trigger or a sheet of its own.
 *
 * Section pages host these in an in-page More sheet. The mode home no longer
 * puts them behind a header ellipsis — Add / verify live on the rows, and
 * My shifts / Pocket card / Calendar sit in Now's footer.
 */
export function OnCallPageMenuActions({
  order,
  onOrderChange,
  onAdd,
  addLabel,
  addHint,
  onVerifyAll,
  staleCount = 0,
  onNavigate,
}: {
  order?: OnCallContactsOrder;
  onOrderChange?: (next: OnCallContactsOrder) => void;
  onAdd?: () => void;
  addLabel?: string;
  /** The line under `addLabel`. Omitted on a page with nothing useful to say. */
  addHint?: string;
  onVerifyAll?: () => void;
  staleCount?: number;
  /** Closes whichever surface is hosting these rows. */
  onNavigate?: () => void;
}) {
  return (
    <div className="grid gap-2">
      {order && onOrderChange ? (
        <div className="grid gap-1.5 pb-1" data-testid="on-call-page-menu-order">
          <p className={cn(eyebrowText)} id="on-call-page-menu-order-label">
            Order
          </p>
          <SegmentedControl
            value={order}
            onChange={onOrderChange}
            ariaLabelledBy="on-call-page-menu-order-label"
            options={[
              { value: "role", label: "By role" },
              { value: "area", label: "By area" },
              { value: "overdue", label: "Overdue first" },
            ]}
          />
        </div>
      ) : null}

      {onAdd ? (
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onAdd();
          }}
          className={inPageActionRowClass}
          data-testid="on-call-page-menu-add"
        >
          <Plus aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="grid gap-0.5">
            <span>{addLabel ?? "Add an entry"}</span>
            {addHint ? <span className={cn(textMuted, "text-xs font-normal")}>{addHint}</span> : null}
          </span>
        </button>
      ) : null}

      {onVerifyAll && staleCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onVerifyAll();
          }}
          className={inPageActionRowClass}
          data-testid="on-call-page-menu-verify-all"
        >
          <Check aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="grid gap-0.5">
            <span>Mark all as still correct</span>
            <span className={cn(textMuted, "text-xs font-normal")}>
              {`Stamps today on ${staleCount} overdue ${staleCount === 1 ? "entry" : "entries"}.`}
            </span>
          </span>
        </button>
      ) : null}

      <Link
        href="/roster"
        onClick={() => onNavigate?.()}
        className={inPageActionRowClass}
        data-testid="on-call-page-menu-shifts"
      >
        <BriefcaseMedical aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="grid gap-0.5">
          <span>My shifts</span>
          <span className={cn(textMuted, "text-xs font-normal")}>Your own roster. Only you can see it.</span>
        </span>
      </Link>

      <Link
        href="/on-call/card"
        onClick={() => onNavigate?.()}
        className={inPageActionRowClass}
        data-testid="on-call-page-menu-card"
      >
        <Printer aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="grid gap-0.5">
          <span>Pocket card</span>
          <span className={cn(textMuted, "text-xs font-normal")}>
            One printable page. Excludes private and overdue entries.
          </span>
        </span>
      </Link>

      <Link
        href="/roster/calendar"
        onClick={() => onNavigate?.()}
        className={inPageActionRowClass}
        data-testid="on-call-page-menu-calendar"
      >
        <Calendar aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="grid gap-0.5">
          <span>Calendar</span>
          <span className={cn(textMuted, "text-xs font-normal")}>
            Teaching sessions and your recorded expiry dates.
          </span>
        </span>
      </Link>

      <div className={cn(inPageActionRowClass, "cursor-default font-normal")} data-testid="on-call-page-menu-privacy">
        <Lock aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="grid gap-0.5">
          <span className="font-semibold">Private entries are yours alone</span>
          <span className={cn(textMuted, "text-xs")}>
            An entry marked private is visible only when you are signed in, never on the printed card, and never to
            anyone else.
          </span>
        </span>
      </div>

      <div className={cn(inPageActionRowClass, "cursor-default font-normal")} data-testid="on-call-page-menu-tags">
        <Tag aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="grid gap-0.5">
          <span className="font-semibold">What the home shows</span>
          <span className={cn(textMuted, "text-xs")}>
            {`Tick "Call first on the home" on a contact to add it to Your usual. Tag a playbook scenario "${ON_CALL_HOME_TAGS.pinned}" to show it first in Who do I call now, as a line to read.`}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * In-page More for an On Call section. Not the universal header trailing slot:
 * that slot is the Needs you bell on the home, and Search my work everywhere.
 */
export function OnCallPageMenu({
  view,
  entryCount,
  order,
  onOrderChange,
  onAdd,
  addLabel,
  addHint,
  onVerifyAll,
  staleCount = 0,
  summary,
}: {
  view: OnCallPageView | "home";
  entryCount?: number;
  summary?: string;
  order?: OnCallContactsOrder;
  onOrderChange?: (next: OnCallContactsOrder) => void;
  onAdd?: () => void;
  addLabel?: string;
  addHint?: string;
  onVerifyAll?: () => void;
  staleCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const title = view === "home" ? "On Call" : ON_CALL_VIEW_TITLES[view];
  const description =
    summary ??
    (typeof entryCount === "number"
      ? `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`
      : "Everything this shift needs, in one place.");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open ${title} actions`}
        data-testid="on-call-page-menu-trigger"
        className={cn(
          "inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text-muted)] transition",
          "hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        )}
      >
        <Ellipsis aria-hidden="true" className="size-icon-md" strokeWidth={2.25} />
        More
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        closeLabel="Close actions"
        returnFocusRef={triggerRef}
        portal
        testId="on-call-page-menu-sheet"
      >
        <OnCallPageMenuActions
          order={order}
          onOrderChange={onOrderChange}
          onAdd={onAdd}
          addLabel={addLabel}
          addHint={addHint}
          onVerifyAll={onVerifyAll}
          staleCount={staleCount}
          onNavigate={() => setOpen(false)}
        />
      </Sheet>
    </>
  );
}
