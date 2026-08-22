import { OctagonX } from "lucide-react";

import {
  describeServiceStop,
  REQUIRED_RESTART_APPROVAL_ROLES,
  type ServiceState,
  type ServiceStopBannerFacts,
} from "@/lib/caring-contacts/service-state";

import {
  CONDENSED_SERVICE_STOP_BAR_ID,
  FULL_BANNER_OUT_OF_VIEW_ATTRIBUTE,
  SERVICE_STOP_BANNER_ID,
} from "./service-stop-bar-anchors";
import { ServiceStopScrollWatcher } from "./service-stop-scroll-watcher";
import { UnavailableDestination } from "./unavailable-destination";

/**
 * The state word, in plain language, carried as text.
 *
 * Not a transport word: "Not delivered" describes one message, and this
 * describes the whole service. Nothing here is ever a patient-state label.
 */
const SERVICE_STOP_STATE_LABEL = "Sending stopped";

/**
 * The rendering half of the banner, and the reason this file has two functions.
 *
 * `ServiceState` carries `note` — free text a responder types mid-incident, which
 * the sealed domain classifies as patient data because it routinely names a
 * patient, a number or a ward. This banner renders on EVERY screen, to EVERY
 * team, including teams that had no part in the incident (spec §4.2), so the note
 * must not merely be left unrendered; it must be out of reach.
 *
 * `ServiceStopBannerFacts` omits `note` by construction, so inside this function
 * the note is not in scope at all and a later edit that tries to show it is a
 * type error rather than a judgement call. That is why the JSX lives here and
 * not in `ServiceStateBanner` below, where the whole state IS in scope: a
 * comment asking a future editor not to interpolate a field sitting in scope is
 * not a guarantee, and the difference between the two functions is the guarantee.
 */
function StoppedServiceBanner({ facts }: { facts: ServiceStopBannerFacts }) {
  // The one source of the banner's wording. `describeServiceStop` returns the
  // categorised reason in plain words, the count of restart approvals recorded
  // out of three, and the roles still outstanding — so what stopped sending,
  // and what would start it again, are stated together and stated here.
  const explanation = describeServiceStop(facts);
  if (explanation === null) return null;

  return (
    <div
      id={SERVICE_STOP_BANNER_ID}
      role="status"
      className="flex min-w-0 flex-col gap-2 border-b border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-4 py-3 sm:px-6 lg:px-8 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--danger-text)] forced-colors:text-[CanvasText]">
        <OctagonX aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{SERVICE_STOP_STATE_LABEL}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">{explanation}</p>
      {/*
        Ruling 52 and `docs/wiring-conventions.md`: `CARING_CONTACTS_ROUTES.serviceStop`
        has no page until Plan 2B builds it, so this states its reason instead of
        linking into a not-found page. Adding the `<Link href={…}>` is the whole of
        that later change; nothing else here moves.
      */}
      <UnavailableDestination
        id="service-state-banner"
        label="Service stop record"
        reason="What stopped sending, and the three approvals from three different people that start it again."
        className="inline-flex min-h-tap w-fit items-center rounded-[var(--radius-md)] border border-[color:var(--danger-border)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text)]"
      />
    </div>
  );
}

/**
 * The service-wide safety stop, stated on every screen while it is active.
 *
 * `null` while the service is running. Spec §4.2 makes this service-wide rather
 * than per-team on purpose: the stop is evidence that the sending path itself
 * cannot currently be trusted, so a team with no part in the incident still has
 * to learn that sending is halted — on every screen, including screens showing
 * no patient at all.
 *
 * The signature takes the whole `ServiceState` because that is what a caller
 * holds. It reads exactly three of its fields and hands them to the narrowed
 * renderer above; `note` is read nowhere and reaches no JSX.
 */
export function ServiceStateBanner({ state }: { state: ServiceState }) {
  if (!state.stopped) return null;
  return (
    <StoppedServiceBanner facts={{ stopped: true, reason: state.reason, restartApprovals: state.restartApprovals }} />
  );
}

/**
 * The condensed bar's one line, and the only place its wording is decided.
 *
 * It may say LESS than the full banner. It may never say anything WEAKER: an abbreviation
 * that dropped "for the whole service" would read as one patient's plan having stopped,
 * which is a different and much smaller claim than the one spec 4.2 requires every screen to
 * carry. So the state label is repeated verbatim and the service-wide scope travels with it.
 *
 * The approval count is read from the facts and the sealed role list on every render rather
 * than frozen into the string: a pinned bar that kept saying "0 of 3" after two approvals had
 * been recorded would be staler than the banner immediately above it.
 *
 * The reason category and the outstanding roles are deliberately left to the full banner. One
 * pinned line cannot carry them at 320px, and the full banner is one scroll away.
 *
 * `ServiceStopBannerFacts` again, for the same reason `describeServiceStop` takes it: `note`
 * is not in scope here, so putting a responder's free text into a bar that sits on screen for
 * the whole of every session is a compile error rather than a judgement call.
 */
function condensedServiceStopStatement(facts: ServiceStopBannerFacts): string | null {
  if (!facts.stopped) return null;
  const recorded = facts.restartApprovals.length;
  const total = REQUIRED_RESTART_APPROVAL_ROLES.length;
  return `${SERVICE_STOP_STATE_LABEL} for the whole service. ${recorded} of ${total} restart approvals recorded.`;
}

/**
 * The rendering half of the condensed bar. Narrowed by the same construction as
 * `StoppedServiceBanner` above, and for the same reason.
 *
 * Positioning, in one place because it is the whole trick: the bar is ABSOLUTELY positioned
 * inside the workspace's sticky header, at `top-full`. Three things follow from that and
 * none of them needs a number.
 *
 *  1. It rides with the header, so it is pinned without a second `sticky` element and
 *     without a magic offset. The header is 87.5px tall at 320 and 390 and 65px from 430 up,
 *     against a 64px `--header-h` token, so any offset written down here would have been
 *     wrong at every width.
 *  2. It is out of flow, so revealing it moves no content. A bar that pushed the page down
 *     as it appeared would push the banner it is watching back towards view.
 *  3. It inherits the header's stacking context, so it needs no `z-index` of its own: it
 *     covers page content, and the phone dock (`--z-chrome`) and the overlay layer
 *     (`--z-modal`) still cover IT. The dock and the primary control are never obscured.
 *
 * `inset-x-0` and no negative insets, which is not the obvious answer and was got wrong first:
 * the containing block for an absolutely positioned child is the header's PADDING BOX, and a
 * padding box is measured OUTSIDE the padding, not inside it. So `inset-x-0` already spans the
 * header's full width, and the `-inset-x-4 sm:-inset-x-6 lg:-inset-x-8` written here to "undo"
 * the header's padding pushed the bar 16px (24px at 768) past the header on each side instead.
 * Caught by the browser proof's left/right edge assertions, which is the only place it could
 * have been caught. The bar carries its own `px-4 sm:px-6 lg:px-8` so its content still lines
 * up with the header's.
 *
 * `aria-hidden` because the full banner is still in the document and still announces. A
 * screen reader does not scroll past anything, so a second live region here would say the
 * same thing twice; this bar is the visual half of that one statement.
 *
 * `print:hidden` because the print rule in `globals.css` makes the header `position: static`
 * to keep the synthetic marker on the page, which would drop this bar onto the printed
 * content it is meant to hover over.
 */
function CondensedStoppedBar({ facts }: { facts: ServiceStopBannerFacts }) {
  const statement = condensedServiceStopStatement(facts);
  if (statement === null) return null;

  return (
    <>
      <div
        id={CONDENSED_SERVICE_STOP_BAR_ID}
        data-testid="caring-contacts-condensed-service-stop"
        {...{ [FULL_BANNER_OUT_OF_VIEW_ATTRIBUTE]: "false" }}
        aria-hidden="true"
        className="absolute inset-x-0 top-full hidden min-h-tap items-center gap-2 border-b border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-4 py-2 text-sm font-semibold text-[color:var(--danger-text)] data-[full-banner-out-of-view=true]:flex sm:px-6 lg:px-8 print:hidden forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
      >
        <OctagonX aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{statement}</span>
      </div>
      <ServiceStopScrollWatcher />
    </>
  );
}

/**
 * The condensed statement of the service-wide safety stop, pinned under the header once the
 * full banner has scrolled out of view. `null` while the service is running.
 *
 * It exists because the full banner sits in normal flow: measured in the browser at the end
 * of Phase 2A, it scrolls entirely off screen at 320, 390, 430 and 768px, and survives at
 * 1024 and 1440 only because the one built page is nearly empty. Spec 4.2 requires the stop
 * to be visible on EVERY screen while it is active, and a statement that has scrolled away
 * is not visible. Pinning the full banner instead was considered and rejected by the owner:
 * it costs roughly a quarter of a phone screen at all times, on every screen.
 *
 * Never both at once. The bar appears exactly when the banner's bottom edge passes the
 * header's bottom edge, which is where the bar starts -- so the two cannot overlap in time.
 *
 * Takes the whole `ServiceState` because that is what a caller holds, reads exactly two of
 * its fields, and hands them to the narrowed renderer above. `note` is read nowhere.
 *
 * The narrowing happens HERE rather than at the call site, which means `state.note` would
 * compile inside this function even though it cannot compile inside `CondensedStoppedBar`.
 * That is deliberate and was ruled on in fix round 1. It is exactly the shape
 * `ServiceStateBanner` below already has, and the two are siblings a reader compares: making
 * one of them take pre-narrowed facts while the other takes the record would cost a reader
 * more than it buys, since this three-line wrapper renders no JSX of its own and the
 * note-sentinel test in `caring-contacts-explained-automation.dom.test.tsx` scans the whole
 * rendered markup at runtime. The compile-time guarantee is where the JSX is.
 */
export function CondensedServiceStopBar({ state }: { state: ServiceState }) {
  if (!state.stopped) return null;
  return (
    <CondensedStoppedBar facts={{ stopped: true, reason: state.reason, restartApprovals: state.restartApprovals }} />
  );
}
