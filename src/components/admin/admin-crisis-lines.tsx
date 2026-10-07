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
import { WA_CRISIS_CONTACTS, type PublicCrisisContact } from "@/lib/crisis-contacts";
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
function CrisisLineRow({ contact }: { contact: PublicCrisisContact }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const testId = `admin-help-crisis-${contact.id}`;
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
            "min-h-12 shrink-0 whitespace-nowrap rounded-md px-1 text-right text-sm text-[color:var(--text)]",
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
 * Crisis lines, first on every state of Help (spec: "Crisis lines sit at the
 * top, reusing the app's existing crisis list"). A flat white work card (work-mode
 * redesign, owner request 6 Oct 2026), no tint,
 * no red border — where 000 alone gets the kit's quiet-red emergency disc and
 * dot, and every other number the neutral disc. Never filtered by "Find in
 * Help", and never hidden by a failed load: this section renders before that
 * check.
 */
export function AdminCrisisLines() {
  return (
    <section data-testid="admin-help-crisis" aria-label="Crisis lines" className="work-card overflow-hidden">
      <ul role="list" className="pt-2">
        {WA_CRISIS_CONTACTS.map((contact) => (
          <CrisisLineRow key={contact.id} contact={contact} />
        ))}
      </ul>
    </section>
  );
}
