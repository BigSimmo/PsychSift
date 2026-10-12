"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { OverlayPortal } from "@/components/ui/overlay-root";
import { canRestoreFocusTo, hasOpenSheet } from "@/components/ui/sheet-focus";
import { cn, toolbarButton } from "@/components/ui-primitives";

export type AnswerSourceDockedPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  closeLabel: string;
  titleAccessory?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Same contract as `Sheet`'s: read at close time, must be referentially stable. */
  resolveReturnFocusTarget?: () => HTMLElement | null;
};

/**
 * The cited source docked beside the answer, from 1024px (the drawer picks it
 * with `useDesktopSourceDock`; below that width the shared `Sheet` drawer is
 * unchanged). It draws the drawer's own header, passage body and pager footer,
 * so what the panel says is identical; only the container differs.
 *
 * It is not a dialog: the answer stays readable and usable beside it, so there
 * is no backdrop, no focus trap and no `aria-modal`. It is a labelled
 * complementary landmark instead. On open, focus moves into it (the panel
 * itself, which a screen reader announces by its title); Escape or the close
 * button closes it, and focus goes back to the citation that opened it (or the
 * source card the drawer names, the same late resolution `Sheet` uses) unless
 * the reader has already moved focus somewhere else on the page.
 *
 * While open it stamps `data-source-docked` on `<body>`; globals.css uses that
 * to move the answer column left so the panel never covers the prose. The
 * bottom search box is not touched.
 */
export function AnswerSourceDockedPanel({
  open,
  onClose,
  title,
  description,
  closeLabel,
  titleAccessory,
  headerActions,
  footer,
  children,
  testId,
  resolveReturnFocusTarget,
}: AnswerSourceDockedPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const resolveReturnRef = useRef(resolveReturnFocusTarget);

  useEffect(() => {
    onCloseRef.current = onClose;
    resolveReturnRef.current = resolveReturnFocusTarget;
  }, [onClose, resolveReturnFocusTarget]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.dataset.sourceDocked = "true";
    panelRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // A dialog over the page (an enlarged image from this panel, a menu
      // sheet) owns Escape; it closes first.
      if (hasOpenSheet()) return;
      event.preventDefault();
      onCloseRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      delete document.body.dataset.sourceDocked;
      // After React removes the panel, focus that was inside it has fallen to
      // <body>. Only then hand it back: a reader who clicked into the answer or
      // the search box while the panel was open keeps their place.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        const target = [resolveReturnRef.current?.() ?? null, opener].find((candidate): candidate is HTMLElement =>
          Boolean(candidate?.isConnected),
        );
        if (target && canRestoreFocusTo(target)) target.focus({ preventScroll: true });
      });
    };
  }, [open]);

  if (!open) return null;

  return (
    <OverlayPortal layer="overlay" name={title}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid={testId}
        data-source-dock-panel=""
        className={cn(
          // Under the app header, above the bottom search box.
          "pointer-events-auto fixed bottom-[8.5rem] right-4 top-[calc(var(--shell-header-h)+1rem)] flex w-[22rem] flex-col overflow-hidden",
          "rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-elevated)]",
          "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          "motion-safe:animate-fade-up motion-reduce:animate-none xl:right-6 xl:w-[26rem]",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] p-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2
                id={titleId}
                className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]"
              >
                {title}
              </h2>
              {titleAccessory}
            </div>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
              {description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label={closeLabel}
              className={toolbarButton}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 polished-scroll">{children}</div>
        {footer ? <div className="shrink-0 border-t border-[color:var(--border)] px-3 py-2">{footer}</div> : null}
      </aside>
    </OverlayPortal>
  );
}
