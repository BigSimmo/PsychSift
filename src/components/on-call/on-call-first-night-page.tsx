"use client";

import { ChevronRight, Moon, Phone, Printer, ShieldAlert, Sunrise } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { cardSurface } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallChecklist } from "@/components/on-call/on-call-checklist";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { OnCallStartingHereChips } from "@/components/on-call/starting-here-chips";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { onCallDetailsSchemaFor, type OnCallEntry } from "@/lib/on-call/entry-model";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { ON_CALL_FIRST_NIGHT_STAGES, type OnCallFirstNightStage } from "@/lib/on-call/first-night";

/**
 * FIRST NIGHT — a guided path for a registrar's first on-call shifts, in three
 * stages: before the first shift, the first night itself, and what to do if
 * something goes wrong.
 *
 * Every prompt here is ADMINISTRATIVE: where things are, who to ring, how to
 * get in. Nothing is clinical advice, which is the Orientation section's own
 * boundary. The starter prompts are the same for everyone; the owner's own
 * Induction manuals (and their checklists) appear under the first stage, so
 * the guide fills in with local detail as the service writes it.
 *
 * Ticks are kept on this device only, like every other On Call checklist.
 */

type Stage = {
  id: OnCallFirstNightStage["id"];
  title: string;
  icon: typeof Sunrise;
  intro: string;
  prompts: readonly { text: string; note?: string }[];
  links: readonly { href: string; label: string; icon: typeof Phone }[];
};

const STAGE_EXTRAS: Record<OnCallFirstNightStage["id"], Pick<Stage, "icon" | "links">> = {
  before: { icon: Sunrise, links: [{ href: "/on-call/card", label: "Your pocket card", icon: Printer }] },
  night: {
    icon: Moon,
    links: [
      { href: "/on-call/playbook", label: "Playbook", icon: Phone },
      { href: "/on-call/contacts", label: "Contacts", icon: Phone },
    ],
  },
  wrong: { icon: ShieldAlert, links: [{ href: "/on-call/playbook", label: "Escalation steps", icon: Phone }] },
};

const STAGES: readonly Stage[] = ON_CALL_FIRST_NIGHT_STAGES.map((stage) => ({
  id: stage.id,
  title: stage.title,
  intro: stage.intro,
  prompts: stage.prompts,
  ...STAGE_EXTRAS[stage.id],
}));

/** Induction manuals from the owner's Orientation section, in their own order. */
function inductionEntries(entries: readonly OnCallEntry[]): OnCallEntry[] {
  return entries
    .filter((entry) => entry.section === "orientation")
    .filter((entry) => {
      const parsed = onCallDetailsSchemaFor("orientation").safeParse(entry.details);
      return parsed.success && (parsed.data as { category?: string }).category?.toLowerCase() === "induction";
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

export function OnCallFirstNightPage() {
  const { entries, isOffline, cachedAt, loadError } = useOnCallEntries();
  const induction = useMemo(() => inductionEntries(entries), [entries]);

  return (
    <>
      {/* Part of Starting here since 11 Oct 2026, so the frame's band names it like its two neighbours. */}
      <InformationPageShell testId="on-call-first-night-main" width="narrow">
        <h1 className="sr-only">First night</h1>
        <OnCallStartingHereChips />
        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
        <p className={cn(textMuted, "mt-3 text-sm")}>
          A short path for your first on-call shifts. Tick things off as you go. Ticks stay on this device only.
        </p>

        <ol className="mt-4 flex flex-col gap-4">
          {STAGES.map((stage, index) => (
            <li key={stage.id} data-testid={`on-call-first-night-${stage.id}`}>
              <StageCard stage={stage} step={index + 1}>
                {stage.id === "before" && induction.length > 0 ? (
                  <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                    {/* Titles only: their checklists are ticked in the Hospital pack, so they are not repeated
                        here word for word (usefulness audit, 11 Oct 2026). Ticks are kept per entry either way. */}
                    <p className={eyebrowText}>From your service&rsquo;s induction</p>
                    <ul className="mt-1 flex flex-col gap-2">
                      {induction.map((entry) => (
                        <li key={entry.id}>
                          <Link
                            href={onCallEntryHref(entry)}
                            className="flex min-h-tap items-center justify-between gap-2 text-sm font-semibold text-[color:var(--text)]"
                          >
                            {entry.title}
                            <ChevronRight aria-hidden="true" className={cn("size-icon-sm", textMuted)} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </StageCard>
            </li>
          ))}
        </ol>
      </InformationPageShell>
    </>
  );
}

function StageCard({ stage, step, children }: { stage: Stage; step: number; children?: ReactNode }) {
  const Icon = stage.icon;
  return (
    <section className={cn(cardSurface, "p-4")} aria-labelledby={`first-night-${stage.id}`}>
      <p className={cn(eyebrowText, "flex items-center gap-1.5")}>
        <Icon aria-hidden="true" className="size-icon-sm" />
        Step {step} of {STAGES.length}
      </p>
      <h2 id={`first-night-${stage.id}`} className="mt-1 text-base font-semibold text-[color:var(--text)]">
        {stage.title}
      </h2>
      <p className={cn(textMuted, "mt-0.5 text-sm")}>{stage.intro}</p>
      <div className="mt-2">
        <OnCallChecklist
          entryId={`first-night-${stage.id}`}
          slug={`first-night-${stage.id}`}
          items={stage.prompts}
          label={stage.title}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4">
        {stage.links.map((link) => (
          <Link
            key={link.href + link.label}
            href={link.href}
            className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)]"
          >
            <link.icon aria-hidden="true" className="size-icon-sm" />
            {link.label}
          </Link>
        ))}
      </div>
      {children}
    </section>
  );
}
