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
import { modeNameText, modeNumberText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import type { PublicCrisisContact } from "@/lib/crisis-contacts";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatUpdatedMonth } from "@/lib/admin/renewal-dates";

/**
 * One crisis line, laid out to stay short at phone width: the name, the
 * number and the call disc share one line, and the hours, the caveat and the
 * updated month sit beneath in small muted text across the row's full width.
 * Every word of the shared list is shown; nothing is truncated. The number is
 * a button that opens the kit's dialling sheet, and the call disc is the
 * `tel:` link inside a 48px tap area, named with the digits spaced out.
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
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {emergency ? (
            <span
              aria-hidden="true"
              data-admin-red="emergency-number"
              data-testid={`${testId}-emergency-dot`}
              className={cn(modeDot, "bg-[color:var(--danger)]")}
            />
          ) : null}
          <span className={cn(modeNameText, "min-w-0 break-words text-sm leading-5 text-[color:var(--text-heading)]")}>
            {contact.name}
          </span>
        </span>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${contact.name}, ${spoken}. Show dialling options`}
          onClick={() => setSheetOpen(true)}
          className={cn(
            focusRing,
            modePressable,
            modeNumberText,
            "min-h-12 min-w-12 shrink-0 whitespace-nowrap rounded-md px-1 text-right text-sm text-[color:var(--text)]",
          )}
          data-testid={`${testId}-number`}
        >
          {number.display}
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
      <p className="-mt-1.5 break-words pr-2 text-xs leading-4 text-[color:var(--text-muted)]">
        {contact.availability} · <span>Updated {formatUpdatedMonth(contact.verifiedOn)}</span>
      </p>
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
