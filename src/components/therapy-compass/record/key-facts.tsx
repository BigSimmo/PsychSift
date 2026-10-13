"use client";

import { Clock, MapPin, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn, textMuted } from "@/components/ui-primitives";
import { Sheet } from "@/components/ui/sheet";

import { interactiveRowBase } from "@/components/ui/interactive-row";
import { ProseBlock } from "../prose";
import type { Therapy } from "../data/types";
import { therapyKeyFactCards, type TherapyKeyFactCard, type TherapyKeyFactId } from "./key-fact-cards";

const ICONS: Record<TherapyKeyFactId, LucideIcon> = {
  cautions: TriangleAlert,
  format: Clock,
  setting: MapPin,
  suits: Users,
};

const cardSurface =
  "flex min-h-[5.75rem] flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] p-1.5 shadow-[var(--shadow-inset)] sm:min-h-[7rem] sm:p-3";

// Phone: Cautions carries a whole sentence, so it takes the full row; Suits then takes the
// last row so the three glance tiles do not leave a hole. Wider screens keep one row of four.
const PHONE_FULL_ROW: ReadonlySet<TherapyKeyFactId> = new Set(["cautions", "suits"]);

function FactCard({ card, onOpen }: { card: TherapyKeyFactCard; onOpen?: () => void }) {
  const Icon = ICONS[card.id];
  const surface = cn(cardSurface, PHONE_FULL_ROW.has(card.id) && "col-span-2 sm:col-span-1");
  const warning = card.id === "cautions";
  const isInteractive = Boolean(card.hasDetail && onOpen);

  const header = (
    <div className="mb-1 flex items-start gap-1.5 sm:mb-2 sm:gap-2">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-9 sm:w-9",
          warning
            ? "border border-[color:var(--warning-border)] bg-[color:var(--surface)] text-[color:var(--warning)]"
            : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        )}
      >
        <Icon className="size-icon-md sm:size-icon-lg" aria-hidden="true" />
      </span>
      <p className="min-w-0 pt-0.5 text-2xs font-bold uppercase leading-4 text-[color:var(--text-muted)]">
        {card.label}
      </p>
    </div>
  );

  const face = isInteractive ? (
    <span className="block text-xs font-semibold leading-tight text-[color:var(--text-heading)] sm:text-sm sm:leading-5">
      {card.face}
    </span>
  ) : (
    <h3 className="text-xs font-semibold leading-tight text-[color:var(--text-heading)] sm:text-sm sm:leading-5">
      {card.face}
    </h3>
  );

  // The four cards sit in one stretched grid row, so the card with the most to say
  // sets the height for all of them. Both variants therefore lay out in the same
  // three zones — header pinned top, face centred in the shared height, footnote
  // pinned bottom and always occupying a line — or a card with nothing to say in a
  // zone comes up short there and the row stops lining up. Same contract as the
  // form priority-fact cards.
  const body = <div className="flex min-w-0 flex-1 flex-col justify-center">{face}</div>;

  if (!isInteractive) {
    return (
      <article className={surface}>
        {header}
        {body}
        <CardFootnote />
      </article>
    );
  }

  return (
    <article className={surface}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className={cn(interactiveRowBase, "flex min-h-12 min-w-0 flex-1 flex-col items-stretch rounded-md text-left")}
        aria-label={`${card.label}: ${card.face}. Open detail.`}
      >
        {header}
        {body}
        <CardFootnote>Tap for detail</CardFootnote>
      </button>
    </article>
  );
}

/**
 * The bottom line of a card. It renders even with nothing to say, because a card
 * that drops the line is 1rem shorter in its body zone than its neighbours and the
 * row stops lining up. The blank stays out of the accessibility tree.
 */
function CardFootnote({ children }: { children?: ReactNode }) {
  return (
    <p className={cn("mt-auto pt-1 text-2xs font-medium leading-4 sm:pt-1.5", textMuted)}>
      {children ?? <span aria-hidden>&nbsp;</span>}
    </p>
  );
}

/**
 * The four facts worth reading before anything else, at the top of the record.
 *
 * Cautions / Format / Setting / Suits. Evidence used to occupy the first tile
 * and named a source it did not show; review status is on the hero badge and
 * provenance is the collapsed strip at the foot. Long fields are glanced here
 * and opened in a sheet — the same contract as form priority-fact cards —
 * rather than line-clamped mid-word. The full fields remain in the body.
 */
export function TherapyKeyFacts({ therapy }: { therapy: Therapy }) {
  const cards = therapyKeyFactCards(therapy);
  const [activeId, setActiveId] = useState<TherapyKeyFactId | null>(null);
  const active = cards.find((card) => card.id === activeId) ?? null;

  return (
    <>
      <section aria-label="Key facts" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cards.map((card) => (
          <FactCard key={card.id} card={card} onOpen={card.hasDetail ? () => setActiveId(card.id) : undefined} />
        ))}
      </section>

      <Sheet
        open={Boolean(active)}
        onClose={() => setActiveId(null)}
        title={active?.label ?? "Key fact"}
        testId="therapy-key-fact-sheet"
        mobilePlacement="bottom"
      >
        {active ? <ProseBlock text={active.body} label={active.label} clamp={false} /> : null}
      </Sheet>
    </>
  );
}
