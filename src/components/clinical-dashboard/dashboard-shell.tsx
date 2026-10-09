"use client";

import { BookOpen, ChevronDown, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import { Sheet, type SheetMobileSize } from "@/components/ui/sheet";
import { ToastRegion } from "@/components/ui/toast";
import { clinicalDivider, cn, iconTilePremium, navPill, panelSubtle, textMuted } from "@/components/ui-primitives";

const sheetMediaQueries = {
  sm: "(max-width: 639px)",
  lg: "(max-width: 1023px)",
  all: "(min-width: 0px)",
} as const;

type UtilityDrawerSheetBreakpoint = keyof typeof sheetMediaQueries;

export { SectionHeading, type SectionHeadingProps } from "@/components/ui/section-heading";
export {
  ToastRegion,
  ToastRegion as ToastHost,
  ToastRegion as DashboardToastHost,
  useToast,
  useOptionalToast,
} from "@/components/ui/toast";

/**
 * #HWYCPF: Shared dashboard shell wrapper mounting ToastRegion for copied feedback.
 */
export function DashboardShell({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <ToastRegion />
    </>
  );
}

export function UtilityDrawer({
  id,
  title,
  icon: Icon,
  summary,
  mobileSummary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  mobileInline = false,
  sheetHeaderLeading,
  sheetTitleAccessory,
  sheetDescriptionContent,
  sheetHeaderActions,
  sheetHeaderClassName,
  sheetTitleClassName,
  sheetCloseButtonClassName,
  sheetChildrenClassName,
  sheetContentClassName,
  sheetContentStyle,
  sheetBodyClassName,
  sheetDescription,
  sheetBreakpoint = "sm",
  sheetMobileSize,
  sheetReturnFocusRef,
}: {
  id?: string;
  title: string;
  icon: LucideIcon;
  summary?: string;
  mobileSummary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  mobileInline?: boolean;
  sheetHeaderLeading?: ReactNode;
  sheetTitleAccessory?: ReactNode;
  sheetDescriptionContent?: ReactNode;
  sheetHeaderActions?: ReactNode;
  sheetHeaderClassName?: string;
  sheetTitleClassName?: string;
  sheetCloseButtonClassName?: string;
  sheetChildrenClassName?: string;
  sheetContentClassName?: string;
  sheetContentStyle?: CSSProperties;
  sheetBodyClassName?: string;
  sheetDescription?: string | null;
  sheetBreakpoint?: UtilityDrawerSheetBreakpoint;
  sheetMobileSize?: SheetMobileSize;
  sheetReturnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  // `all` always matches; default true so the first open does not mount drawer
  // children in the hidden <details> (browser autoFocus) then remount into Sheet.
  const [usesSheet, setUsesSheet] = useState(sheetBreakpoint === "all");
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  const sheetTriggerClassName =
    sheetBreakpoint === "all" ? "block" : sheetBreakpoint === "lg" ? "lg:hidden" : "sm:hidden";
  const inlineDrawerClassName =
    sheetBreakpoint === "all" ? "hidden" : sheetBreakpoint === "lg" ? "hidden lg:block" : "hidden sm:block";
  const triggerClassName = cn(
    "flex min-h-[56px] w-full cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition motion-safe:duration-[var(--duration-quick)] hover:bg-[color:var(--surface-subtle)]",
    className,
  );
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(sheetMediaQueries[sheetBreakpoint]);
    const sync = () => setUsesSheet(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, [sheetBreakpoint]);

  return (
    <>
      <button
        ref={mobileTriggerRef}
        type="button"
        id={id ? `${id}-mobile-trigger` : undefined}
        onClick={() => setOpen(true)}
        aria-expanded={usesSheet ? open : undefined}
        className={cn("group", sheetTriggerClassName, triggerClassName, mobileInline && "hidden")}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={iconTilePremium}>
            <Icon aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[color:var(--text)]">{title}</span>
            {(mobileSummary || summary) && (
              <span className={cn("mt-0.5 block truncate text-xs", textMuted)}>{mobileSummary ?? summary}</span>
            )}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 -rotate-90 text-[color:var(--text-muted)] transition motion-safe:duration-[var(--duration-quick)]"
        />
      </button>

      <details
        id={id}
        open={open && (!usesSheet || mobileInline)}
        onToggle={(event) => {
          if (usesSheet && !mobileInline) return;
          const nextOpen = event.currentTarget.open;
          if (nextOpen !== open) setOpen(nextOpen);
        }}
        className={cn("group overflow-hidden", mobileInline ? "block" : inlineDrawerClassName, panelSubtle)}
      >
        <summary className={triggerClassName}>
          <span className="flex min-w-0 items-center gap-3">
            <span className={iconTilePremium}>
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[color:var(--text)]">{title}</span>
              {summary ? (
                <>
                  {mobileInline && mobileSummary ? (
                    <span className={cn("mt-0.5 block text-xs leading-4 sm:hidden", textMuted)}>{mobileSummary}</span>
                  ) : null}
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-xs",
                      textMuted,
                      mobileInline && mobileSummary && "hidden sm:block",
                    )}
                  >
                    {summary}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition motion-safe:duration-[var(--duration-quick)] group-open:rotate-180"
          />
        </summary>
        {open && (!usesSheet || mobileInline) && <div className={cn(clinicalDivider, "p-4")}>{children}</div>}
      </details>

      <Sheet
        open={usesSheet && open && !mobileInline}
        onClose={() => setOpen(false)}
        dismissOnBack
        title={title}
        description={sheetDescription === undefined ? (mobileSummary ?? summary) : (sheetDescription ?? undefined)}
        closeLabel={`Close ${title}`}
        headerLeading={sheetHeaderLeading}
        titleAccessory={sheetTitleAccessory}
        descriptionContent={sheetDescriptionContent}
        headerActions={sheetHeaderActions}
        headerClassName={sheetHeaderClassName}
        titleClassName={sheetTitleClassName}
        closeButtonClassName={sheetCloseButtonClassName}
        contentClassName={sheetContentClassName}
        contentStyle={sheetContentStyle}
        bodyClassName={sheetBodyClassName}
        mobileSize={sheetMobileSize}
        returnFocusRef={sheetReturnFocusRef ?? mobileTriggerRef}
        portal
      >
        <div className={cn("space-y-3", sheetChildrenClassName)}>{children}</div>
      </Sheet>
    </>
  );
}

export function GuideTrigger({ onOpen, onPrefetch }: { onOpen: () => void; onPrefetch?: () => void }) {
  return (
    <div className="flex justify-center pt-1">
      <button
        type="button"
        data-testid="dashboard-guide-trigger"
        onClick={onOpen}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        className={cn(navPill, "px-3")}
        aria-label="Open user guide"
      >
        <BookOpen aria-hidden="true" className="h-4 w-4" />
        Guide
      </button>
    </div>
  );
}
