"use client";

import Link from "next/link";
import { ChevronRight, Copy, Eye } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { ContractEndEntryLink } from "@/components/admin/contract/contract-entry-link";
import { copyLabel, JuniorFootNote, JuniorNotice, JuniorSectionLabel, useCopy } from "@/components/admin/junior/junior-shared";
import { StarterPackEntryLink } from "@/components/admin/starter/starter-pack-entry-link";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeFeaturedModule } from "@/components/mode-kit/featured-module";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import {
  buildReadyForDayOne,
  readyAccessibleLabel,
  readyStartsLine,
  readyStatusText,
  type ReadyForDayOne,
  type ReadyItem,
  type ReadyState,
} from "@/lib/admin/ready-for-day-one";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

const GROUP_ORDER: readonly { state: ReadyState; label: string }[] = [
  { state: "to-do", label: "To do" },
  { state: "in-progress", label: "In progress" },
  { state: "recorded", label: "Recorded" },
  { state: "left-out", label: "Not counted" },
];

function segmentClass(state: ReadyState): string {
  if (state === "recorded") return "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]";
  if (state === "in-progress") return "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]";
  return "border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]";
}

/** One segment per counted item, in the fixed order. Its words are the label. */
function ReadyBar({ ready }: { ready: ReadyForDayOne }) {
  const counted = ready.items.filter((item) => item.state !== "left-out");
  return (
    <div className="grid gap-2">
      <div role="img" aria-label={readyAccessibleLabel(ready)} className="flex gap-1" data-testid="admin-ready-bar">
        {counted.map((item) => (
          <span key={item.id} aria-hidden="true" className={cn("h-2.5 min-w-0 flex-1 rounded-full border", segmentClass(item.state))} />
        ))}
      </div>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text)]">
        {(["recorded", "in-progress", "to-do"] as const).map((state) => (
          <li key={state} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-4 rounded-full border", segmentClass(state))} />
            {state === "recorded" ? "Recorded" : state === "in-progress" ? "In progress" : "To do"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyRow({ item }: { item: ReadyItem }) {
  return (
    <li className="border-b border-[color:var(--border)] last:border-b-0">
      <Link href={item.href} className={cn(focusRing, "flex min-h-12 items-center gap-3 px-3 py-2")} data-testid={`admin-ready-item-${item.id}`}>
        <span className="grid min-w-0 flex-1">
          <span className="text-sm font-medium text-[color:var(--text-heading)]">{item.title}</span>
          <span className={cn(textMuted, "text-xs")}>
            {item.status}
            {item.detail ? ` · ${item.detail}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-[color:var(--clinical-accent)]">{item.action}</span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </li>
  );
}

/**
 * Ready for day one, `/admin/new-job/ready` (junior feature #21, the
 * doctor's side). A third view of the doctor's own Admin rows: item by item,
 * what is recorded and what is still to do before the start date, and a
 * status-words-only copy for Medical Workforce. Nothing is shared from here;
 * the Workforce side is deferred.
 */
export function ReadyForDayOnePage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const loadState = adminLoadState(state);
  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const ready = useMemo(() => buildReadyForDayOne(own, now), [own, now]);
  const statusText = readyStatusText(ready, now);
  const startsLine = readyStartsLine(ready, now);
  const { copy, stateFor } = useCopy();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const copyStatus = (key: string) => void copy(statusText, key, "Status copied. Paste it into your email to Medical Workforce.");

  return (
    <>
      <InformationPageShell testId="admin-ready-main">
        <div className="grid gap-1">
          <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">Ready for day one</PageTitleUnderBand>
          <p className={cn(textMuted, "text-sm")} data-testid="admin-ready-starts">
            {loadState === "ready" ? (startsLine ?? "No start date recorded yet") : "From your own Admin records"}
          </p>
        </div>

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-ready-load-failed" />
        ) : loadState === "loading" ? (
          <ModeModuleSkeleton rows={6} twoLine eyebrow testId="admin-ready-loading" />
        ) : loadState === "signed-out" ? (
          <JuniorNotice
            title="Sign in to see what is ready"
            testId="admin-ready-signed-out"
            action={
              <Button variant="primary" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            }
          >
            This card reads the dates you record in Admin for your signed-in account.
          </JuniorNotice>
        ) : (
          <>
            {state.demoMode ? (
              <p className={cn(textMuted, "text-sm")} data-testid="admin-ready-demo">
                These are example records. Sign in to see your own.
              </p>
            ) : null}

            <ModeFeaturedModule as="section" mode="my-work" className="grid min-w-0 gap-3 p-4" testId="admin-ready-hero">
              <div className="flex items-end justify-between gap-3">
                <div className="grid gap-0.5">
                  <h2 className={eyebrowText}>Before you start</h2>
                  <p className="text-lg-minus font-semibold text-[color:var(--text-heading)]" data-testid="admin-ready-count">
                    <span className="nums">{ready.recorded}</span> of <span className="nums">{ready.counted}</span> recorded
                  </p>
                </div>
                <p className={cn(textMuted, "nums shrink-0 text-sm")}>{ready.toDo === 1 ? "1 to do" : `${ready.toDo} to do`}</p>
              </div>
              <ReadyBar ready={ready} />
              <div className="grid gap-2">
                <Button variant="primary" block icon={Copy} onClick={() => copyStatus("status")} testId="admin-ready-copy">
                  {copyLabel(stateFor("status"), "Copy status for Medical Workforce")}
                </Button>
                <Button variant="secondary" block icon={Eye} onClick={() => setPreviewOpen(true)} testId="admin-ready-preview-open">
                  See what they get
                </Button>
              </div>
              <p className={cn(textMuted, "text-xs")}>Status words only. No dates of your checks, numbers or files.</p>
            </ModeFeaturedModule>

            {!ready.startsOn ? (
              <JuniorNotice
                title="Add your start date"
                testId="admin-ready-no-start"
                action={
                  <Link href="/admin/new-job" className={cn(focusRing, "inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--clinical-accent)]")}>
                    Set it in New job
                  </Link>
                }
              >
                With a start date, anything that ends before you start moves to To do.
              </JuniorNotice>
            ) : null}

            {GROUP_ORDER.map(({ state: groupState, label }) => {
              const items = ready.items.filter((item) => item.state === groupState);
              if (items.length === 0) return null;
              return (
                <section key={groupState} aria-labelledby={`admin-ready-${groupState}-heading`} className="grid gap-2">
                  <JuniorSectionLabel id={`admin-ready-${groupState}-heading`} count={items.length}>
                    {label}
                  </JuniorSectionLabel>
                  <ul className={cn(cardSurface, "overflow-hidden")} data-testid={`admin-ready-group-${groupState}`}>
                    {items.map((item) => (
                      <ReadyRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              );
            })}

            <JuniorNotice title="Medical Workforce cannot see this card" testId="admin-ready-workforce-note">
              Sharing it with them directly is not built yet. Copy the status and send it yourself.
            </JuniorNotice>
          </>
        )}

        <div className="grid gap-2">
          <StarterPackEntryLink />
          <ContractEndEntryLink />
        </div>

        <JuniorFootNote testId="admin-ready-foot">
          From the dates you recorded, not a check with any issuer. Kept in your account only.
        </JuniorFootNote>
      </InformationPageShell>

      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="What Medical Workforce gets"
        description="Exactly what Copy puts on your clipboard"
        testId="admin-ready-preview"
        footer={
          <Button variant="primary" block icon={Copy} onClick={() => copyStatus("sheet")} testId="admin-ready-preview-copy">
            {copyLabel(stateFor("sheet"), "Copy status")}
          </Button>
        }
      >
        <div className="grid gap-3">
          <p className="whitespace-pre-line rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6" data-testid="admin-ready-preview-text">
            {statusText}
          </p>
          <p className={cn(textMuted, "text-sm")}>
            Never included: the dates of your checks, registration or card numbers, files, or anything about your vaccines.
          </p>
        </div>
      </Sheet>

      {loadState === "signed-out" ? <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} /> : null}
    </>
  );
}
