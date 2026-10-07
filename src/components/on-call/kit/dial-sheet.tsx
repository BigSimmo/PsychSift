"use client";

import { Phone, Share2 } from "lucide-react";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import {
  modeCallDiscShape,
  modeInsetHairline,
  modeModuleSurface,
  modeRowHeight,
  modeTapArea,
} from "@/components/mode-kit/recipes";
import { modeDisplayNumberText, modeNameText, modeNumberText } from "@/components/mode-kit/type";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { spokenOnCallNumber, type HandbookDial } from "@/lib/on-call/number-resolver";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

/** What to key on a hospital handset: the extension when there is one, otherwise the number. */
export function onCallHospitalPhoneText(dial: HandbookDial): string {
  if (dial.kind === "switchboard-extension") return `ext ${dial.extension}`;
  return dial.display;
}

/** The route a mobile can ring, or null when none is recorded. */
export function onCallMobileRoute(dial: HandbookDial, mobileDial?: HandbookDial | null): HandbookDial | null {
  if (dial.tel) return dial;
  return mobileDial?.tel ? mobileDial : null;
}

/**
 * A bare extension as a call link, for a hospital-issued handset only (the
 * reader's "I'm on a hospital phone" switch). Never a mobile route: a personal
 * mobile dialling those digits does not reach the extension.
 */
export function onCallExtensionRoute(dial: HandbookDial): HandbookDial | null {
  if (dial.kind !== "extension") return null;
  // "000…" is the sample's placeholder range, and keying it can reach Triple Zero: never a call link.
  if (/^000/.test(dial.extension)) return null;
  return { kind: "direct", display: dial.display, tel: `tel:${dial.extension}`, copy: dial.copy, route: "any-phone" };
}

/**
 * What a row's call disc rings: the extension itself while this phone is a
 * hospital phone, otherwise the mobile route.
 */
export function onCallCallRoute(
  dial: HandbookDial,
  mobileDial?: HandbookDial | null,
  hospitalPhone = false,
): HandbookDial | null {
  const extension = hospitalPhone ? onCallExtensionRoute(dial) : null;
  return extension ?? onCallMobileRoute(dial, mobileDial);
}

/** What a row's own page adds to its dial sheet, given a way to close the sheet. */
export type OnCallDialSheetActionsRender = (sheet: { readonly close: () => void }) => ReactNode;

const OnCallDialSheetActionsContext = createContext<OnCallDialSheetActionsRender | null>(null);

/**
 * Extra actions for every dial sheet opened inside it, such as People's
 * "Didn't connect" mark (mock-up v10: the mark is made from the number's
 * sheet, not from a button on every row). A context rather than a prop, so the
 * shared dial row needs no new prop to carry it; it reaches the portalled sheet
 * because React context follows the component tree, not the DOM.
 */
export function OnCallDialSheetActions({
  render,
  children,
}: {
  readonly render: OnCallDialSheetActionsRender;
  readonly children: ReactNode;
}) {
  return <OnCallDialSheetActionsContext.Provider value={render}>{children}</OnCallDialSheetActionsContext.Provider>;
}

const noSubscription = () => () => {};
const canShareNow = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * "Dial from a desk phone" (amendment 1.6, I1): the sheet that opens when a
 * row's number text is tapped.
 *
 * It names the role and the hospital, then shows what to key on a hospital
 * handset in large 300-weight digits, the route from a mobile (with its own
 * call link) or "Not recorded" in muted grey, Copy and Share, and the Updated
 * line. Sizes, colours and radii come from the kit recipes, so a visual pass
 * changes them in one place.
 */
export function OnCallDialSheet({
  open,
  onClose,
  title,
  hospitalName,
  dial,
  mobileDial,
  updatedAt,
  sources,
  reviewedAt,
  lastConfirmedAt,
  now,
  onCall,
  hospitalPhone = false,
  hospitalPhoneSwitch,
  testId,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The role or place, e.g. "Registrar". */
  readonly title: string;
  readonly hospitalName?: string | null;
  readonly dial: HandbookDial;
  /** The "From a mobile:" route recorded beside a short code, if any. */
  readonly mobileDial?: HandbookDial | null;
  readonly updatedAt?: string | null;
  readonly sources?: readonly { readonly label: string; readonly url: string }[];
  readonly reviewedAt?: string | null;
  readonly lastConfirmedAt?: string | null;
  readonly now?: Date;
  /** Called when the mobile call link is tapped, so the row can record it. */
  readonly onCall?: () => void;
  /** This phone is a hospital phone: the extension gets its own call link (v6 fig 12). */
  readonly hospitalPhone?: boolean;
  /** The "I'm on a hospital phone" switch, shown under a bare extension. */
  readonly hospitalPhoneSwitch?: ReactNode;
  readonly testId?: string;
}) {
  const canShare = useSyncExternalStore(noSubscription, canShareNow, () => false);
  const { active: example } = useExampleData("call");
  const extraActions = useContext(OnCallDialSheetActionsContext);
  const hospitalText = onCallHospitalPhoneText(dial);
  const mobile = onCallMobileRoute(dial, mobileDial);
  const extensionCall = hospitalPhone ? onCallExtensionRoute(dial) : null;
  const copyLabel = `${dial.route === "hospital-phone" ? "Copy extension" : "Copy number"} for ${title}`;

  const share = () => {
    if (!guardExampleAction(example, "share")) return;
    if (!canShareNow()) return;
    const where = hospitalName ? `, ${hospitalName}` : "";
    // A rejected or cancelled share is not an error worth showing.
    navigator.share({ title, text: `${title}${where}: ${dial.display}` }).catch(() => {});
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} testId={testId}>
      <div
        data-mode-identity="on-call"
        className="grid min-w-0 gap-4"
        data-testid={testId ? `${testId}-body` : undefined}
      >
        {hospitalName ? (
          <p className={cn(modeNameText, "break-words text-base-minus text-[color:var(--text-muted)]")}>
            {hospitalName}
          </p>
        ) : null}

        {dial.kind === "none" ? null : (
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid min-w-0 flex-1 gap-1">
              {dial.route ? (
                <span className="text-sm text-[color:var(--text-muted)]">From a hospital phone</span>
              ) : null}
              <span
                data-testid={testId ? `${testId}-number` : undefined}
                className={cn(modeDisplayNumberText, "break-words text-hero text-[color:var(--text-heading)]")}
              >
                {hospitalText}
              </span>
            </div>
            {extensionCall?.tel ? (
              <a
                href={extensionCall.tel}
                onClick={onCall}
                aria-label={`Call ${title} from this hospital phone, ${spokenOnCallNumber(extensionCall.display)}`}
                data-testid={testId ? `${testId}-extension-call` : undefined}
                className={cn(modeTapArea, focusRing, "ml-auto rounded-full")}
              >
                <span aria-hidden="true" className={modeCallDiscShape.neutral}>
                  <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
                </span>
              </a>
            ) : null}
          </div>
        )}

        <ul role="list" className={modeModuleSurface}>
          <li
            className={cn(
              modeInsetHairline,
              modeRowHeight.double,
              "flex min-w-0 flex-wrap items-center gap-x-3 py-1.5 pl-3 pr-1",
            )}
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm text-[color:var(--text-muted)]">From your mobile</span>
              {mobile ? (
                <span className={cn(modeNumberText, "break-words text-base-minus text-[color:var(--text)]")}>
                  {mobile.display}
                </span>
              ) : (
                <span className="text-base-minus text-[color:var(--text-muted)]">Not recorded</span>
              )}
            </span>
            {mobile?.tel ? (
              <a
                href={mobile.tel}
                onClick={onCall}
                aria-label={`Call ${title} from your mobile, ${spokenOnCallNumber(mobile.display)}`}
                className={cn(modeTapArea, focusRing, "ml-auto rounded-full")}
              >
                <span aria-hidden="true" className={modeCallDiscShape.neutral}>
                  <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
                </span>
              </a>
            ) : null}
          </li>
        </ul>

        {dial.kind === "extension" ? hospitalPhoneSwitch : null}

        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {dial.copy ? (
            <OnCallCopyNumber value={dial.copy} label={copyLabel} testId={testId ? `${testId}-copy` : undefined} />
          ) : null}
          {canShare ? (
            <ModeActionButton
              icon={Share2}
              label={`Share ${title}`}
              onClick={share}
              testId={testId ? `${testId}-share` : undefined}
            />
          ) : null}
        </div>

        {extraActions ? extraActions({ close: onClose }) : null}

        <OnCallUpdatedLine
          updatedAt={updatedAt ?? null}
          sources={sources}
          reviewedAt={reviewedAt}
          lastConfirmedAt={lastConfirmedAt}
          now={now}
        />
      </div>
    </Sheet>
  );
}
