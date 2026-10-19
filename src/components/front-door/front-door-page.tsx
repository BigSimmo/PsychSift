import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { NavigationBackButton } from "@/components/navigation-back-button";
import { PageHeader } from "@/components/ui/page-header";
import { cn, searchPageCanvas, searchPageShellStandalone, toneWarning } from "@/components/ui-primitives";
import { FRONT_DOOR_DRAFT_DISCLAIMER, FRONT_DOOR_DRAFT_MARKER, type FrontDoorSection } from "@/lib/front-door-content";

/**
 * Shared chrome for the About and Terms of Use pages.
 *
 * Standalone like `/privacy` and `/reference/colour-coding`: outside the
 * `(search-app)` group, so it is readable before sign-in and owns the safe-area
 * top pad through `searchPageShellStandalone`. Copy lives in
 * `src/lib/front-door-content.ts`, which is DRAFT until the owner signs it off.
 */
export function FrontDoorPage({
  title,
  description,
  icon,
  sections,
  meta,
  testId,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  sections: FrontDoorSection[];
  /** Extra line under the draft badge, such as the terms version. */
  meta?: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid={testId}
      className={cn(
        searchPageCanvas,
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <div className={searchPageShellStandalone}>
        <div className="mx-auto grid w-full max-w-reading grid-cols-[minmax(0,1fr)] gap-6">
          <div className="flex min-h-tap items-center">
            <NavigationBackButton fallbackHref="/" />
          </div>
          <PageHeader
            title={title}
            description={description}
            icon={icon}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="front-door-draft-marker"
                  className={cn(toneWarning, "rounded-full border px-2 py-0.5 text-xs font-semibold")}
                >
                  {FRONT_DOOR_DRAFT_MARKER}
                </span>
                {meta ? <span className="text-xs font-medium text-[color:var(--text-muted)]">{meta}</span> : null}
              </span>
            }
          />
          <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
            {FRONT_DOOR_DRAFT_DISCLAIMER}
          </p>
          <div className="grid gap-6">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="grid gap-2"
              >
                <h2 id={`${section.id}-heading`} className="text-lg font-semibold text-[color:var(--text-heading)]">
                  {section.heading}
                </h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-base leading-7 text-[color:var(--text)]">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>
          {children}
          <nav
            aria-label="Related pages"
            className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[color:var(--border)] pt-4 text-sm font-semibold"
          >
            <Link
              href="/about"
              className="inline-flex min-h-tap items-center text-[color:var(--clinical-accent)] underline underline-offset-4"
            >
              About PsychSift
            </Link>
            <Link
              href="/terms"
              className="inline-flex min-h-tap items-center text-[color:var(--clinical-accent)] underline underline-offset-4"
            >
              Terms of Use
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-tap items-center text-[color:var(--clinical-accent)] underline underline-offset-4"
            >
              Privacy and data processing
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
