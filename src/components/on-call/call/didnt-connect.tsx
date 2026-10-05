"use client";

import { PhoneOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import { clearOnCallDidntConnect, markOnCallDidntConnect } from "@/components/on-call/call/call-device-stores";
import { focusRing } from "@/components/card-recipes";
import { onCallOutlineButton } from "@/components/on-call/kit/calm";
import { OnCallDialSheetActions } from "@/components/on-call/kit/dial-sheet";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import type { HandbookReportResult, HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { HANDBOOK_REPORT_REASONS, type HandbookReportReason } from "@/lib/on-call/handbook-reports";
import type { HandbookDial } from "@/lib/on-call/number-resolver";

const REASONS = Object.entries(HANDBOOK_REPORT_REASONS) as [HandbookReportReason, string][];

/** What a report's result says, in one calm line. "already-reported" needs none: its button reads "Reported". */
const RESULT_NOTICE: Partial<Record<HandbookReportResult, { tone: "neutral"; text: string }>> = {
  sent: { tone: "neutral", text: "Sent to your hospital's editors." },
  failed: { tone: "neutral", text: "Could not send. Try again later." },
  demo: { tone: "neutral", text: "Demo mode sends nothing." },
};

/**
 * "Didn't connect" (plan 3.3, idea 3; mock-up v10 s-2). The mark is made from
 * the number's own dial sheet, not from a button on every row: wrap a dial row
 * in this and its sheet gains a "Didn't connect" button.
 *
 * A tap marks the row on this phone ("Didn't connect at 02:14", 12 hours),
 * closes the dial sheet and opens the "Didn't connect" sheet with the fallback,
 * switchboard, as a dial row. A handbook row can also be reported to the
 * hospital's editors, with one of two fixed reasons and no free text (review
 * F9); an outside line or the reader's own number has no one to report it to,
 * so it gets the mark only. The mark never hides, greys out or reorders the
 * number.
 */
export function OnCallDidntConnect({
  id,
  title,
  report,
  switchboard,
  switchboardDial,
  hospitalName,
  hospitalPhone = false,
  children,
}: {
  readonly id: string;
  readonly title: string;
  /** The hospital handbook, for a handbook row only. Null: mark only. */
  readonly report: HospitalHandbookState | null;
  /** The hospital's Switchboard row, when it has one. */
  readonly switchboard: HandbookItem | null;
  readonly switchboardDial: HandbookDial | null;
  readonly hospitalName: string | null;
  /** This phone is a hospital phone: a bare-extension switchboard rings its own digits. */
  readonly hospitalPhone?: boolean;
  /** The dial row whose sheet carries the mark. */
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<HandbookReportResult | null>(null);
  const [sending, setSending] = useState<HandbookReportReason | null>(null);

  const send = async (reason: HandbookReportReason) => {
    if (!report) return;
    setSending(reason);
    try {
      setResult(await report.report(id, reason));
    } catch {
      setResult("failed");
    } finally {
      setSending(null);
    }
  };

  const notice = result ? RESULT_NOTICE[result] : undefined;
  const showSwitchboard = switchboard && switchboardDial && switchboard.id !== id;

  return (
    <>
      <OnCallDialSheetActions
        render={({ close }) => (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Didn't connect: ${title}`}
            onClick={() => {
              markOnCallDidntConnect(id);
              setResult(null);
              close();
              setOpen(true);
            }}
            data-testid={`on-call-didnt-connect-${id}`}
            className={cn(onCallOutlineButton, focusRing, "w-full")}
          >
            <PhoneOff aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
            Didn&apos;t connect
          </button>
        )}
      >
        {children}
      </OnCallDialSheetActions>
      <Sheet open={open} onClose={() => setOpen(false)} title="Didn't connect" testId="on-call-didnt-connect-sheet">
        <div data-mode-identity="on-call" className="grid min-w-0 gap-5">
          {showSwitchboard ? (
            <OnCallGroupedList eyebrow="Try switchboard" testId="on-call-didnt-connect-switchboard">
              <OnCallDialRow
                id={switchboard.id}
                source="handbook"
                title={switchboard.parsed.label}
                dial={switchboardDial}
                hospitalPhone={hospitalPhone}
                updatedAt={switchboard.updatedAt}
                sources={switchboard.sources}
                hospitalName={hospitalName}
                testId="on-call-didnt-connect-switchboard-row"
              />
            </OnCallGroupedList>
          ) : null}

          {report ? (
            <section className="grid min-w-0 gap-2" aria-labelledby="on-call-didnt-connect-report">
              <h3 id="on-call-didnt-connect-report" className={`${eyebrowText} px-3`}>
                Tell your hospital&apos;s editors
              </h3>
              <div className="grid min-w-0 gap-2">
                {REASONS.map(([reason, label]) => {
                  const reported = report.hasReported(id, reason);
                  return (
                    <Button
                      key={reason}
                      variant="secondary"
                      block
                      disabled={reported || sending !== null}
                      busy={sending === reason}
                      onClick={() => void send(reason)}
                      testId={`on-call-didnt-connect-report-${reason}`}
                    >
                      {reported ? "Reported" : label}
                    </Button>
                  );
                })}
              </div>
              {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}
            </section>
          ) : null}

          <Button
            variant="secondary"
            block
            onClick={() => {
              clearOnCallDidntConnect(id);
              setOpen(false);
            }}
            testId="on-call-didnt-connect-clear"
          >
            Clear mark
          </Button>
        </div>
      </Sheet>
    </>
  );
}
