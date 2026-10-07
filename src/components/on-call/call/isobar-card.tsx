"use client";

import { BookOpen, ChevronRight } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeFactTile, ModeFactTiles } from "@/components/mode-kit/fact-tile";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { ISOBAR_HEADINGS, ISOBAR_SOURCE } from "@/lib/on-call/isobar-source";

/**
 * "Calling a consultant" (plan 3.3): the iSoBAR headings exactly as the WA
 * source prints them, then that source's link and the day it was read. No
 * inputs, no copy button and nothing stored. It renders nothing until the
 * source has been captured (`ISOBAR_SOURCE` is null until then), so no heading
 * is ever written from memory.
 */
export function OnCallIsobarCard() {
  const source = ISOBAR_SOURCE;
  if (!source || ISOBAR_HEADINGS.length === 0) return null;
  return (
    <section
      className="grid min-w-0 gap-2"
      aria-labelledby="on-call-call-isobar-heading"
      data-testid="on-call-call-isobar"
    >
      <h2 id="on-call-call-isobar-heading" className={`${eyebrowText} px-3`}>
        Calling a consultant
      </h2>
      <ModeFactTiles>
        {ISOBAR_HEADINGS.map((row) => (
          <ModeFactTile key={row.letter} label={row.letter} value={row.heading} />
        ))}
      </ModeFactTiles>
      <div className="px-3">
        <OnCallUpdatedLine updatedAt={source.readOn} sources={[{ label: source.publisher, url: source.url }]} />
      </div>
    </section>
  );
}

/**
 * People's "Calling a consultant" row (mock-up v10 s-2): one row that opens the
 * card above in a sheet. Like the card, it renders nothing until the source is
 * captured, so the row never promises headings the app does not have.
 */
export function OnCallIsobarRow() {
  const [open, setOpen] = useState(false);
  if (!ISOBAR_SOURCE || ISOBAR_HEADINGS.length === 0) return null;
  return (
    <li className={cn(modeInsetHairline, "min-w-0")} data-testid="on-call-call-isobar-row">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          modeRowHeight.double,
          modePressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-x-3 pl-3 pr-2 text-left",
        )}
      >
        <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
          <BookOpen aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5 py-1.5">
          <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            Calling a consultant
          </span>
          <span className={cn(modeSecondaryText, "break-words leading-5")}>
            The handover headings, from the WA source
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Calling a consultant" testId="on-call-call-isobar-sheet">
        <div data-mode-identity="on-call" className="min-w-0">
          <OnCallIsobarCard />
        </div>
      </Sheet>
    </li>
  );
}
