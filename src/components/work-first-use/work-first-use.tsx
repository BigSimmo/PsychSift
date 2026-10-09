"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import { FIRST_USE } from "@/lib/example-data/first-use-copy";
import { useExampleData } from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

export type WorkFirstUseProps = {
  readonly area: WorkAreaId;
  /** Overrides the area's own first step address. */
  readonly primaryHref?: string;
  readonly secondaryHref?: string;
  /** A first step that opens something on the page (a sheet) instead of going somewhere. */
  readonly onPrimary?: () => void;
  readonly onSecondary?: () => void;
};

/**
 * What a work area shows before it has any data (setup mockup, "First use"
 * frames): what the area is for, one clear next step, a second way in, and a
 * quiet offer to look around with example data. Never a dead screen.
 */
export function WorkFirstUse({ area, primaryHref, secondaryHref, onPrimary, onSecondary }: WorkFirstUseProps) {
  const copy = FIRST_USE[area];
  const { on, turnOn } = useExampleData(area);
  const router = useRouter();

  const lookAround = useCallback(() => {
    turnOn();
    // Teaching and CPD read the example data cookie on the server.
    router.refresh();
  }, [router, turnOn]);

  return (
    <WorkCard testId={`work-first-use-${area}`}>
      <WorkEmpty
        icon={workFrameIcons[copy.icon]}
        // WorkEmpty draws its title as a paragraph: this keeps the look and makes it a heading for screen readers.
        title={
          <span role="heading" aria-level={2}>
            {copy.title}
          </span>
        }
        body={copy.body}
        action={
          <div className="grid w-full max-w-[18.75rem] gap-2">
            {onPrimary ? (
              <WorkButton size="wide" onClick={onPrimary}>
                {copy.primary.label}
              </WorkButton>
            ) : (
              <WorkButton size="wide" href={primaryHref ?? copy.primary.href}>
                {copy.primary.label}
              </WorkButton>
            )}
            {onSecondary ? (
              <WorkButton size="wide" variant="secondary" onClick={onSecondary}>
                {copy.secondary.label}
              </WorkButton>
            ) : (
              <WorkButton size="wide" variant="secondary" href={secondaryHref ?? copy.secondary.href}>
                {copy.secondary.label}
              </WorkButton>
            )}
            {on ? null : (
              <button
                type="button"
                onClick={lookAround}
                className="inline-flex min-h-12 items-center justify-center rounded-full px-3 text-sm-minus font-bold text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]"
              >
                Look around with example data
              </button>
            )}
          </div>
        }
      />
    </WorkCard>
  );
}
