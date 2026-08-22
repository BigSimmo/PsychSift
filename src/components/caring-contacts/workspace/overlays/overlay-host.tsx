"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  cn,
  controlBase,
  floatingControl,
  ignoreUnavailableActivation,
  primaryControl,
} from "@/components/ui-primitives";
import { Sheet } from "@/components/ui/sheet";

import { widthStateFor } from "../width-state";
import {
  overlayDefinition,
  type OverlayDesktopModality,
  type OverlayDismissal,
  type OverlayPhoneModality,
  type WorkspaceOverlayDefinition,
} from "./definitions";

/**
 * ONE renderer for all twenty-four workspace overlays.
 *
 * Rule 1 of the Task 18 contract: modality comes from the frozen table in
 * `./definitions.ts`, never from a per-overlay component. There is no switch on
 * an overlay id anywhere in this file — every branch below is a branch on a
 * MODALITY, of which there are four, and the branch a given overlay takes is
 * read off the table at render time. That is what makes the twenty-four rows
 * data rather than code, and it is what lets Task 19 prove all of them in a
 * browser against the same table this file reads.
 *
 * This is a Client Component, and deliberately the smallest one that can be. The
 * shell's service-wide safety-stop record must never reach here: its incident
 * note is free text a responder typed mid-incident, and a client boundary
 * serialises its props into the payload the browser can read. `blockReason` is a
 * NAMED refusal string, not that record and not any part of it, precisely so this
 * boundary can exist at all. The allowlist and its three conditions are in
 * `tests/caring-contacts-explained-automation.dom.test.tsx` (Ruling 59), and that
 * guard reads this file's source text — which is why the record's own module and
 * type names are described here rather than written.
 */

export type OverlayHostProps = {
  openOverlayId: string | null;
  onClose: () => void;
  onCommit: (definition: WorkspaceOverlayDefinition) => void;
  /** A named permission/connectivity refusal, or null. Never the safety-stop record, or any part of it. */
  blockReason: string | null;
};

type OverlayModality = OverlayPhoneModality | OverlayDesktopModality;
type SheetModality = Exclude<OverlayModality, "status-banner">;

/**
 * How each Sheet-borne modality is expressed through the shared `Sheet`, in one
 * table rather than scattered through the render.
 *
 * `full-screen-stage` and `session-gate` both take `fullscreen`: on a phone the
 * gate must own the whole screen, and `fullscreen` also suppresses the Sheet's
 * drag grip, which would otherwise advertise a swipe-to-dismiss the gate does
 * not honour. `inspection-drawer` takes right-edge geometry; it occurs only as a
 * desktop modality (its phone counterpart in the table is `full-screen-stage`),
 * so that fixed right placement is never asked to behave like a phone sheet.
 */
const SHEET_GEOMETRY: Record<
  SheetModality,
  { placement: "default" | "right"; mobilePlacement: "bottom" | "fullscreen" }
> = {
  "bottom-sheet": { placement: "default", mobilePlacement: "bottom" },
  dialog: { placement: "default", mobilePlacement: "bottom" },
  "full-screen-stage": { placement: "default", mobilePlacement: "fullscreen" },
  "inspection-drawer": { placement: "right", mobilePlacement: "bottom" },
  "session-gate": { placement: "default", mobilePlacement: "fullscreen" },
};

function subscribeToViewportWidth(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function readViewportWidth() {
  return window.innerWidth;
}

/** No width is knowable on the server, so no modality is either — render nothing. */
function noViewportWidth() {
  return null;
}

function useViewportWidth(): number | null {
  return useSyncExternalStore(subscribeToViewportWidth, readViewportWidth, noViewportWidth);
}

/**
 * Rule 2: the shared four-state mapping decides, and nothing here re-derives a
 * breakpoint. A second `matchMedia` copy of 768 is exactly how the layout and
 * the overlays would drift apart without anybody noticing.
 */
function modalityFor(definition: WorkspaceOverlayDefinition, viewportWidth: number): OverlayModality {
  return widthStateFor(viewportWidth) === "compact" ? definition.phoneModality : definition.desktopModality;
}

/**
 * Whether Escape and a backdrop click dismiss this overlay.
 *
 * The frozen matrix produces exactly two dismissal values (Ruling 58). The third
 * union member, `action-only`, is reserved and unreachable, and an unrecognised
 * value must NOT fall through to the permissive branch: silently treating an
 * unknown dismissal as escape-closable would let a future row that means "the
 * user must not be able to walk away from this" behave as though they could. So
 * it throws where a developer will see it, and degrades to the conservative
 * (non-dismissible) answer in production, where the recovery action is still on
 * screen.
 */
export function dismissesOnEscapeOrBackdrop(dismissal: OverlayDismissal): boolean {
  if (dismissal === "escape-backdrop-close") return true;
  if (dismissal === "recovery-only") return false;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      `Unrecognised overlay dismissal "${dismissal}". The frozen matrix expresses only ` +
        `"escape-backdrop-close" and "recovery-only"; "action-only" is reserved and unreachable ` +
        `(Ruling 58). Decide the behaviour against docs/caring-contacts/interaction-matrix.md ` +
        `rather than defaulting it here.`,
    );
  }
  return false;
}

/**
 * Ruling 61: the plain words each named refusal is shown as.
 *
 * `blockReason` is an identifier — `permission-unavailable` is a key, not a
 * sentence, and spec §4.4 requires the reason a clinician reads to be in plain
 * words. The mapping is explicit and TOTAL: every reason this workspace can
 * refuse an action for has an entry written by hand, and an unmapped key throws
 * rather than falling back.
 *
 * Both prohibitions in that ruling are load-bearing and neither is stylistic:
 *
 *  - No default branch. A default would let a future reason ship unnoticed,
 *    reading as though somebody had chosen its wording.
 *  - No derivation from the identifier. Turning `permission-unavailable` into
 *    "Permission unavailable" produces a plausible-looking sentence nobody
 *    wrote, which is worse than an obviously missing one — the same reason
 *    Ruling 57 made the matrix normalisation explicit rather than mechanical.
 *
 * `OverlayHostProps.blockReason` is a pinned `string | null`, so this cannot be
 * total at the type level; `blockReasonWording` closes it at runtime instead.
 *
 * Exactly two entries, matching the two categories the pinned prop names — "a
 * named permission/connectivity refusal" — and no more. Pre-writing wording for
 * refusals nothing produces yet would be speculative copy nobody reviewed against
 * a real screen; the throw is what makes the next one get written deliberately.
 */
const BLOCK_REASON_WORDING: Readonly<Record<string, string>> = Object.freeze({
  "permission-unavailable": "You do not have permission to carry out this action.",
  "connection-unavailable": "There is no connection, so nothing can be changed from here.",
});

/** The reasons `blockReasonWording` can render. Exported so a test can walk all of them. */
export const NAMED_BLOCK_REASONS: readonly string[] = Object.freeze(Object.keys(BLOCK_REASON_WORDING));

/**
 * Throws, deliberately and in every environment, on a reason with no wording.
 *
 * A render-time throw here lands on `src/app/caring-contacts/error.tsx`, which
 * says plainly that nothing was sent and nothing was changed — a true statement,
 * and the conservative outcome. Showing a machine identifier to a clinician, or
 * inventing wording for it, would both be worse than that.
 */
export function blockReasonWording(reason: string): string {
  // `Object.hasOwn`, not `map[reason] === undefined`.
  //
  // `BLOCK_REASON_WORDING` is an object literal, so it inherits from
  // `Object.prototype`: `BLOCK_REASON_WORDING["toString"]` is a FUNCTION, not
  // `undefined`, and so are `constructor`, `valueOf`, `hasOwnProperty` and
  // `__proto__`. A `=== undefined` guard waves all of them through, TypeScript
  // types the result `string`, and React renders a function as nothing — leaving a
  // blocked control whose `aria-describedby` points at an EMPTY paragraph. No
  // wording, no throw, no error boundary: a clinician told an action is unavailable
  // and given no reason at all. That is the "plausible instead of visible" failure
  // Ruling 61 forbids, arrived at by inheritance rather than by a default branch.
  //
  // `blockReason` is a pinned `string | null` supplied by an arbitrary caller, so
  // this is not hypothetical once a later task starts passing one.
  //
  // Task 17 hit the identical defect in its matrix normalisation and fixed it the
  // same way. A per-lookup fix does not travel between lookups, which is the actual
  // lesson: every string-keyed object-literal lookup in this codebase needs its own.
  if (!Object.hasOwn(BLOCK_REASON_WORDING, reason)) {
    throw new Error(
      `No plain-words wording for the block reason "${reason}". Ruling 61: add an entry to ` +
        `BLOCK_REASON_WORDING deliberately. Do not derive it from the identifier and do not add a ` +
        `default branch — an unwritten reason must be visible, not plausible.`,
    );
  }
  return BLOCK_REASON_WORDING[reason];
}

function actionClassFor(tone: WorkspaceOverlayDefinition["tone"]) {
  if (tone === "danger") {
    return cn(
      controlBase,
      "border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-5 text-[color:var(--danger)]",
    );
  }
  return tone === "primary" ? primaryControl : floatingControl;
}

function noop() {}

type OverlayBodyProps = {
  definition: WorkspaceOverlayDefinition;
  modality: OverlayModality;
  /** Rendered as the overlay's own heading when the surface carries no Sheet header. */
  headingId: string | null;
  blockReason: string | null;
  checkpointOpen: boolean;
  /**
   * Stamps the shared Sheet's `data-sheet-autofocus` hook on the action control.
   *
   * WCAG 2.4.3, and the reason it is decided here rather than in the design system. A
   * `recovery-only` overlay is given no `title` (see the Sheet below), so the Sheet renders no
   * header and its close-button fallback resolves to null -- and with no other hint in the panel
   * the opening focus lands on `document.body`. On the one overlay a person cannot dismiss and
   * must act on, a screen reader announces that as nothing having happened. The Sheet already
   * exposes the hook for exactly this; the overlay only has to say which control is the target.
   */
  autoFocusAction: boolean;
  onActivate: () => void;
};

/**
 * The one body every overlay renders, whatever surface carries it.
 *
 * The three data attributes are the contract Task 19 asserts against in a real
 * browser, which is why they are stamped from the definition rather than from
 * anything this component decided for itself.
 */
function OverlayBody({
  definition,
  modality,
  headingId,
  blockReason,
  checkpointOpen,
  autoFocusAction,
  onActivate,
}: OverlayBodyProps) {
  // Rule 9, and both halves of it: a mutating overlay's action is refused with
  // the named reason visible, and a read-only overlay stays fully usable —
  // blocking a preview nobody can change would be the same defect pointing the
  // other way. `mutatesState` is read from the table, never re-decided here.
  // Resolved once, here, so the plain-words lookup runs only for an overlay that
  // is actually refused — a read-only overlay never reaches Ruling 61's throw.
  const refusal = blockReason !== null && definition.mutatesState ? blockReasonWording(blockReason) : null;
  const blocked = refusal !== null;
  const reasonId = `caring-contacts-overlay-${definition.id}-reason`;
  return (
    /*
      What `data-overlay-modality` means, exactly (Ruling 60).

      It reports the modality the FROZEN CONTRACT chose for this row at this
      width — `widthStateFor(viewportWidth) === "compact" ? phoneModality :
      desktopModality`. That is the authoritative statement of the contract, and
      it matches rendered geometry below 640px and at 768px and above.

      Between 640 and 767 it does not, and cannot: `widthStateFor` switches
      compact→rail at 768, while the shared `Sheet` switches its mobile geometry
      to a centred dialog at Tailwind `sm:` = 640, entirely in CSS with no prop
      to override it. So a `bottom-sheet` row in that band stamps
      `bottom-sheet` and renders as a dialog. `full-screen-stage` rows are
      unaffected — `mobilePlacement="fullscreen"` transitions at `lg:` (1024),
      so they stay fullscreen right across the band.

      Ruling 60 leaves that divergence in place rather than fighting it:
      `sheet.tsx` is a design-system component the whole application uses,
      `widthStateFor` is frozen design non-regression, and a className override
      forcing bottom geometry to 768 would fight the shared component's own
      cascade and break silently the next time it changed. Nothing in the
      24-overlay contract's SAFETY properties — dismissal, fresh authentication,
      blocking — depends on geometry, and the frozen mapping never samples
      431–767 (its review widths are 320/390/430, then 768, 1024, 1440).

      The band is pinned by "the stamped modality and the Sheet's own geometry
      breakpoint disagree only between 640 and 767" in
      `tests/caring-contacts-overlay-host.dom.test.tsx`, so it cannot widen
      unnoticed. Whether the two breakpoints should be reconciled at all is a
      design-record question for the owner, not a fix.
    */
    <div
      data-testid="workspace-overlay-content"
      data-overlay-id={definition.id}
      data-overlay-modality={modality}
      data-overlay-dismissal={definition.dismissal}
      className="flex min-w-0 flex-col gap-4"
    >
      {headingId ? (
        <h2 id={headingId} className="text-base font-semibold text-[color:var(--text-heading)]">
          {definition.title}
        </h2>
      ) : null}
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">{definition.summary}</p>

      {checkpointOpen ? (
        <p className="max-w-[var(--measure)] rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6 text-[color:var(--text)]">
          Fresh authentication checkpoint. Confirm who you are before this is recorded. Nothing has changed yet.
        </p>
      ) : null}

      {refusal ? (
        <p id={reasonId} className="max-w-[var(--measure)] text-sm font-medium leading-6 text-[color:var(--danger)]">
          {refusal}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="workspace-overlay-action"
          data-sheet-autofocus={autoFocusAction ? "true" : undefined}
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={blocked ? ignoreUnavailableActivation : onActivate}
          className={actionClassFor(definition.tone)}
        >
          {checkpointOpen ? "Confirm and continue" : definition.decision}
          {/*
            The decision text alone is ambiguous out of context — "Continue and
            confirm who you are" reads identically on withdrawal and on
            reassignment. Naming the overlay keeps the control's purpose
            available from its accessible name (WCAG 2.4.6) without repeating the
            heading on screen.
          */}
          <span className="sr-only"> ({definition.label})</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Rule 4: `status-banner` is NOT a dialog. It portals to the document body as a
 * live region, takes no focus, traps none, and offers its recovery action in
 * place. Anything that made it modal would let a connectivity notice block the
 * screen it is only reporting on.
 */
function StatusBannerSurface({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      role="status"
      data-testid="workspace-overlay-status-banner"
      className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-4 pb-[var(--safe-area-bottom)] pt-4 shadow-[var(--e4)] sm:px-6 forced-colors:bg-[Canvas]"
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </div>,
    document.body,
  );
}

export function OverlayHost({ openOverlayId, onClose, onCommit, blockReason }: OverlayHostProps) {
  const viewportWidth = useViewportWidth();
  const [checkpoint, setCheckpoint] = useState<{ id: string } | null>(null);
  /**
   * The control the overlay was opened from, handed to the Sheet as
   * `returnFocusRef` (rule 6).
   *
   * The timing is the whole trick, and it survives on a detail of the shared
   * Sheet rather than on luck: the Sheet's open-focus controller moves focus
   * inside a `requestAnimationFrame`, and this effect runs on commit — before
   * that frame — so `document.activeElement` is still the opener when it is
   * read. Capturing during render would be earlier still, but reading or writing
   * a ref there is what `react-hooks/refs` forbids, and it is right to: it is
   * invisible to the compiler's reasoning about what a render depends on.
   */
  const openedFromRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (openOverlayId === null) return;
    openedFromRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [openOverlayId]);

  // Adjusting state while a prop changes, the documented React way: a checkpoint
  // raised for one overlay must never be inherited by the next one opened.
  if (checkpoint !== null && checkpoint.id !== openOverlayId) setCheckpoint(null);

  const definition = openOverlayId === null ? null : overlayDefinition(openOverlayId);
  const checkpointOpen =
    definition !== null && definition.requiresFreshAuthentication && checkpoint?.id === definition.id;

  /**
   * Rule 8: an overlay the table marks `requiresFreshAuthentication` commits
   * only on the SECOND activation. The first raises a visible checkpoint and
   * commits nothing — which is the whole point, so it is an early return rather
   * than a flag threaded through a commit path.
   */
  const activate = useCallback(() => {
    if (definition === null) return;
    if (definition.requiresFreshAuthentication && checkpoint?.id !== definition.id) {
      setCheckpoint({ id: definition.id });
      return;
    }
    onCommit(definition);
  }, [checkpoint, definition, onCommit]);

  /**
   * Nothing is knowable about the modality without a width, and a width is a
   * browser fact — so the server renders nothing and the first client render
   * agrees with it. An unknown `?overlay=` value lands here too: a bad URL, not
   * a defect.
   *
   * The closed Sheet stays MOUNTED rather than being replaced by `null`. It
   * renders no DOM while closed, but the shared Sheet restores focus from its
   * open-effect cleanup and skips that work when it is unmounting — so a host
   * that vanished the instant the overlay closed would drop focus on the floor
   * instead of returning it to the control that opened it.
   */
  if (viewportWidth === null || definition === null) {
    return (
      <Sheet open={false} title="" onClose={onClose}>
        {null}
      </Sheet>
    );
  }

  const modality = modalityFor(definition, viewportWidth);
  const dismissible = dismissesOnEscapeOrBackdrop(definition.dismissal);
  const headingId = `caring-contacts-overlay-${definition.id}-title`;

  const body = (
    <OverlayBody
      definition={definition}
      modality={modality}
      // A Sheet header already renders the title; the surfaces without one carry
      // their heading in the body and name the dialog through it.
      headingId={modality === "status-banner" || !dismissible ? headingId : null}
      // Only a Sheet-borne overlay that cannot be dismissed: the status banner is not a dialog,
      // takes no focus by design (Rule 4), and a dismissible Sheet already has a close control for
      // the shared component's own fallback to find.
      autoFocusAction={modality !== "status-banner" && !dismissible}
      blockReason={blockReason}
      checkpointOpen={checkpointOpen}
      onActivate={activate}
    />
  );

  if (modality === "status-banner") {
    return <StatusBannerSurface>{body}</StatusBannerSurface>;
  }

  // The other string-keyed object-literal lookup in this file, and the audit that
  // followed the `BLOCK_REASON_WORDING` defect says it is safe where that one was
  // not — for a reason worth writing down rather than trusting to memory. Its key
  // type is `SheetModality`, a closed union whose only values come from the frozen
  // table, so no caller-supplied string reaches it and `"toString"` is a compile
  // error rather than a runtime hit. The difference is the key type, not the map
  // shape: if this ever became keyed by `string`, it would need `Object.hasOwn` too.
  const geometry = SHEET_GEOMETRY[modality];
  return (
    <Sheet
      open
      // Rule 5: a `recovery-only` overlay ignores Escape and the backdrop. The
      // shared Sheet routes both through `onClose`, so withholding the handler
      // is the whole of it — and with no `title` the Sheet renders no header, so
      // no close control contradicts "recovery action only" either.
      onClose={dismissible ? onClose : noop}
      title={dismissible ? definition.title : ""}
      labelledBy={dismissible ? undefined : headingId}
      returnFocusRef={openedFromRef}
      placement={geometry.placement}
      mobilePlacement={geometry.mobilePlacement}
      testId="workspace-overlay-sheet"
      id={`caring-contacts-overlay-${definition.id}`}
    >
      {body}
    </Sheet>
  );
}
