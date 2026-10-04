"use client";
import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { UniversalHeaderTrailingPortal } from "@/components/clinical-dashboard/universal-header-trailing-portal";
import { PRIMER_EVENT } from "@/components/first-nations/primer";
import { openReadingTrustSheet } from "@/components/first-nations/reading-trust-sheet";
import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { cmeLearningFromSourceHref } from "@/lib/cme/learning-source";

type MenuProps = {
  pageTitle: string;
  href: string;
  reportHref: string | null;
  training: { label: string; href: string } | null;
  /** Closes whichever surface is hosting these rows. */
  onNavigate?: () => void;
};

export function firstNationsCpdHref(pageTitle: string, href: string): string | null {
  return cmeLearningFromSourceHref({ title: `First Nations: ${pageTitle}`, href });
}

/** Carries the page, never anything about a patient; opening the CPD form logs nothing until the doctor saves. */
export function FirstNationsMenuActions({ pageTitle, href, reportHref, training, onNavigate }: MenuProps) {
  const cpd = firstNationsCpdHref(pageTitle, href);
  return (
    <div className="grid">
      <Link href="/first-nations/card" className={inPageActionRowClass} onClick={onNavigate}>
        Pocket card
      </Link>
      {reportHref ? (
        <a href={reportHref} className={inPageActionRowClass}>
          Report a wrong number
        </a>
      ) : null}
      {training ? (
        <a href={training.href} className={inPageActionRowClass} rel="noreferrer" target="_blank">
          {training.label}
        </a>
      ) : null}
      <button
        type="button"
        className={inPageActionRowClass}
        onClick={() => {
          onNavigate?.();
          openReadingTrustSheet();
        }}
      >
        What am I reading?
      </button>
      <button
        type="button"
        className={inPageActionRowClass}
        onClick={() => {
          onNavigate?.();
          window.dispatchEvent(new Event(PRIMER_EVENT));
        }}
      >
        About this mode
      </button>
      {cpd ? (
        <Link href={cpd} className={inPageActionRowClass} onClick={onNavigate}>
          Log as CPD
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Bedside has no in-page header, so its ••• portals into the universal header and
 * opens the rows in a sheet, the same trigger and sheet as On Call's home menu.
 */
export function FirstNationsHomeMenu(props: Omit<MenuProps, "onNavigate">) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <UniversalHeaderTrailingPortal>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open First Nations actions"
          className={cn(
            "universal-header-icon-control relative inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-full",
            "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition",
            "hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          )}
        >
          <Ellipsis aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
        </button>
      </UniversalHeaderTrailingPortal>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="First Nations"
        closeLabel="Close actions"
        returnFocusRef={triggerRef}
        portal
      >
        <FirstNationsMenuActions {...props} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
