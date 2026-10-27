"use client";

import { Phone } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { spokenModeNumber } from "@/components/mode-kit/dates";
import { ModeDialSheet } from "@/components/mode-kit/dial-sheet";
import {
  modeCallDiscShape,
  modeDot,
  modeInsetHairline,
  modePressable,
  modeTapArea,
} from "@/components/mode-kit/recipes";
import { modeNameText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import type { PublicCrisisContact } from "@/lib/crisis-contacts";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatUpdatedMonth } from "@/lib/admin/updated-month";

/**
 * One crisis line, laid out the way On Call lays out its numbers (owner build, 27 Oct 2026): the
 * name, then the number on its own line, then the hours and the updated month, with the call disc
 * on the right. Before, the number sat beside the name, so a long name such as MHERL wrapped to
 * three lines with the number floating mid-row. Every word of the shared list is shown; nothing is
 * truncated. The name and number together are one button that opens the kit's dialling sheet, and
 * the call disc is the `tel:` link inside a 48px tap area, named with the digits spaced out.
 */
function CrisisLineRow({ contact, testIdPrefix }: { contact: PublicCrisisContact; testIdPrefix: string }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const testId = `${testIdPrefix}-${contact.id}`;
  const emergency = contact.isEmergencyService;
  const number = {
    display: displayPhoneNumber(contact.telephoneDisplay, "outside"),
    tel: `tel:${contact.telephoneUri}`,
  };
  const spoken = spokenModeNumber(number.display);

  return (
    <li data-testid={testId} className={cn(modeInsetHairline, "grid min-w-0 gap-0.5 pb-2 pl-3 pr-1")}>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-haspopup="dialog"
          // The number as shown, so a voice-control user can say it, then digit by digit (A11Y-02).
          aria-label={`${contact.name}, ${number.display} (${spoken}). Show dialling options`}
          onClick={() => setSheetOpen(true)}
          className={cn(
            focusRing,
            modePressable,
            "grid min-h-12 min-w-0 flex-1 content-center gap-0.5 rounded-md py-1.5 pr-1 text-left",
          )}
          data-testid={`${testId}-number`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {emergency ? (
              <span
                aria-hidden="true"
                data-admin-red="emergency-number"
                data-testid={`${testId}-emergency-dot`}
                className={cn(modeDot, "bg-[color:var(--danger)]")}
              />
            ) : null}
            <span
              className={cn(modeNameText, "min-w-0 break-words text-sm leading-5 text-[color:var(--text-heading)]")}
            >
              {contact.name}
            </span>
          </span>
          <span className="nums whitespace-nowrap text-sm font-semibold leading-5 tracking-wide text-[color:var(--text-heading)]">
            {number.display}
          </span>
          <span className="break-words text-xs leading-4 text-[color:var(--text-muted)]">
            {contact.availability} · <span>Updated {formatUpdatedMonth(contact.verifiedOn)}</span>
          </span>
        </button>
        <a
          href={number.tel}
          aria-label={`Call ${contact.name}, ${spoken}`}
          className={cn(modeTapArea, focusRing, "rounded-full")}
          data-testid={`${testId}-call`}
        >
          <span aria-hidden="true" className={emergency ? modeCallDiscShape.emergency : modeCallDiscShape.neutral}>
            <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
          </span>
        </a>
      </div>
      {contact.caveat ? (
        <p className="break-words pr-2 text-xs leading-4 text-[color:var(--text-muted)]">{contact.caveat}</p>
      ) : null}
      <ModeDialSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label={contact.name}
        number={number}
        testId={`${testId}-sheet`}
      />
    </li>
  );
}

/**
 * The one crisis card (design audit D02, 13 Oct 2026): Admin Help and the Clinical answer
 * crisis card print the same rows, so the numbers, their 48px call links and their caveats look
 * and behave the same wherever a clinician meets them. 000 alone gets the quiet-red emergency
 * disc and dot. On Call keeps its own rows because they also say whether a line is open now.
 */
export function CrisisLinesCard({
  contacts,
  testId,
  rowTestIdPrefix,
  label = "Crisis lines",
  heading,
}: {
  readonly contacts: readonly PublicCrisisContact[];
  readonly testId: string;
  readonly rowTestIdPrefix: string;
  readonly label?: string;
  readonly heading?: string;
}) {
  return (
    <section data-testid={testId} aria-label={label} className="work-card overflow-hidden">
      {heading ? (
        <p className="px-3 pt-3 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{heading}</p>
      ) : null}
      <ul role="list" className="pt-2">
        {contacts.map((contact) => (
          <CrisisLineRow key={contact.id} contact={contact} testIdPrefix={rowTestIdPrefix} />
        ))}
      </ul>
    </section>
  );
}
