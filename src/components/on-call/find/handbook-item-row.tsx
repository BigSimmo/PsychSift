"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { OnCallHospitalPhoneSwitch } from "@/components/on-call/call/hospital-phone-switch";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { focusRing } from "@/components/card-recipes";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";

const MACHINE_LINE = /^\s*(Also known as|From a mobile):/i;

/** The hospital's own words, without the two lines the app reads for itself. */
export function handbookBodyText(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !MACHINE_LINE.test(line))
    .join("\n")
    .trim();
}

/** The first line of the hospital's own words, for a row's second line. */
export function handbookFirstLine(body: string): string | null {
  return (
    handbookBodyText(body)
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

/**
 * One handbook item as a row whose detail opens in a sheet (standard v8
 * modules 1 and 6), for Refer and Find. Nothing expands in place.
 *
 * - With no phone, the whole row is the button: the label at 500 and a 13px
 *   muted second line, with a chevron.
 * - With a phone, the row is the kit's dial row (number column, call disc,
 *   desk-only rule, the hospital-phone switch), and its last control opens the
 *   same detail sheet.
 *
 * The sheet holds the body in the hospital's own words (`whitespace-pre-line`,
 * never rewritten), the "Also known as" names, the number again, and the
 * Updated line with sources. Titles wrap and are never truncated (#8RWKA0).
 *
 * `listOnly` keeps a numbered item as a chevron row too (Refer), so its
 * `meta` line can sit under the text; the call link is then in the sheet.
 */
export function OnCallHandbookItemRow({
  item,
  secondary,
  hospitalName,
  hospitalPhone,
  detailTestId,
  testId,
  leading,
  meta,
  listOnly = false,
}: {
  readonly item: HandbookItem;
  readonly secondary: string | null;
  /** A muted glyph or badge before the text (mock-up v10). */
  readonly leading?: ReactNode;
  /** A third line under the secondary one, such as Refer's "Updated" line. */
  readonly meta?: ReactNode;
  /**
   * Draw a chevron row even when the item has a number: the number and its
   * call link then live in the detail sheet (Refer, mock-up v10 s-3).
   */
  readonly listOnly?: boolean;
  readonly hospitalName: string | null;
  readonly hospitalPhone: boolean;
  readonly detailTestId: string;
  readonly testId: string;
}) {
  const [open, setOpen] = useState(false);
  const label = item.parsed.label;
  const body = handbookBodyText(item.body);
  const dial = item.dial;
  const hospitalPhoneSwitch = <OnCallHospitalPhoneSwitch on={hospitalPhone} testId="on-call-hospital-phone-sheet" />;
  const hasNumber = dial.kind !== "none";

  const detail = (
    <Sheet open={open} onClose={() => setOpen(false)} title={label} testId={detailTestId}>
      <div className="grid min-w-0 gap-4">
        {body ? (
          <p className="whitespace-pre-line break-words text-base-minus text-[color:var(--text)]">{body}</p>
        ) : null}
        {item.aliases.length > 0 ? (
          <p className={cn(modeSecondaryText, "break-words")}>Also known as {item.aliases.join(", ")}</p>
        ) : null}
        {hasNumber ? (
          <OnCallGroupedList>
            <OnCallDialRow
              id={item.id}
              source="handbook"
              title={label}
              dial={dial}
              mobileDial={item.mobileDial}
              hospitalPhone={hospitalPhone}
              hospitalPhoneSwitch={hospitalPhoneSwitch}
              updatedAt={item.updatedAt}
              lastConfirmedAt={item.lastConfirmedAt}
              sources={item.sources}
              hospitalName={hospitalName}
              testId={`${testId}-detail-dial`}
            />
          </OnCallGroupedList>
        ) : null}
        <OnCallUpdatedLine
          updatedAt={item.updatedAt}
          lastConfirmedAt={item.lastConfirmedAt}
          sources={item.sources}
          testId="on-call-updated-date"
        />
      </div>
    </Sheet>
  );

  if (hasNumber && !listOnly) {
    return (
      <>
        <OnCallDialRow
          id={item.id}
          source="handbook"
          title={label}
          subtitle={secondary ?? undefined}
          dial={dial}
          mobileDial={item.mobileDial}
          hospitalPhone={hospitalPhone}
          hospitalPhoneSwitch={hospitalPhoneSwitch}
          updatedAt={item.updatedAt}
          lastConfirmedAt={item.lastConfirmedAt}
          sources={item.sources}
          hospitalName={hospitalName}
          leading={leading}
          trailingAction={
            <ModeActionButton
              icon={ChevronRight}
              label={`Details: ${label}`}
              onClick={() => setOpen(true)}
              testId={`${testId}-details`}
            />
          }
          testId={testId}
        />
        {detail}
      </>
    );
  }

  return (
    <li className={cn(modeInsetHairline, "min-w-0")} data-testid={testId}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          secondary || meta ? modeRowHeight.double : modeRowHeight.single,
          modePressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-3 pl-3 pr-2 text-left",
        )}
      >
        {leading ? (
          <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
            {leading}
          </span>
        ) : null}
        <span className="grid min-w-0 flex-1 gap-0.5 py-1.5">
          <span className={cn(modeNameText, "break-words text-base-minus text-[color:var(--text-heading)]")}>
            {label}
          </span>
          {secondary ? <span className={cn(modeSecondaryText, "break-words")}>{secondary}</span> : null}
          {meta}
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
      {detail}
    </li>
  );
}
