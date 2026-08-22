import { CalendarDays, FileText, HeartHandshake, LayoutDashboard, MoreHorizontal, Plus, Users } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

import { WorkspaceOverlays } from "./overlays/workspace-overlays";
import { CondensedServiceStopBar, ServiceStateBanner } from "./service-state-banner";
import { WORKSPACE_HEADER_ID } from "./service-stop-bar-anchors";
import { SyntheticMarker } from "./synthetic-marker";
import { UnavailableDestination } from "./unavailable-destination";
import type { WorkspaceWidthState } from "./width-state";

// Re-exported so Tasks 16-18 keep one import site for the shell and its safeguard.
export { FICTIONAL_DATA_MARKER } from "./synthetic-marker";

/** The anchor the phone "More" destination jumps to. */
const MORE_DESTINATIONS_ID = "caring-contacts-more";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type WorkspaceDestination = {
  id: string;
  label: string;
  icon: NavigationIcon;
  /** Present only once the destination has a page. Absent means unavailable. */
  href?: string;
  /** Plain words: what this destination holds, or will hold. */
  reason: string;
};

/**
 * The four primary destinations, frozen by the approved route identities.
 *
 * Only `Today` has a page in Phase 2A, so only `Today` carries an `href`. The
 * other three render as unavailable controls that state their reason rather
 * than as links into a not-found page (Ruling 52). Plan 2B gives them pages,
 * and adding an `href` here is the whole of that change.
 */
const PRIMARY_DESTINATIONS: readonly WorkspaceDestination[] = [
  {
    id: "today",
    label: "Today",
    icon: LayoutDashboard,
    href: CARING_CONTACTS_ROUTES.today,
    reason: "The day's caring-contact work for this team.",
  },
  {
    id: "patients",
    label: "Patients",
    icon: Users,
    reason: "Every patient with a caring-contact plan, and where each plan has got to.",
  },
  { id: "schedule", label: "Schedule", icon: CalendarDays, reason: "Contacts due, day by day." },
  {
    id: "templates",
    label: "Templates",
    icon: FileText,
    reason: "Governed pathways, message wording and approval history.",
  },
];

/** The phone bar carries three destinations plus a jump to the More panel. */
const PHONE_DESTINATIONS = PRIMARY_DESTINATIONS.filter((destination) => destination.id !== "templates");

/**
 * Every remaining declared destination, with what it will hold.
 * `docs/wiring-conventions.md` requires the reason to be stated, not implied.
 */
const MORE_DESTINATIONS: readonly { id: string; label: string; reason: string }[] = [
  { id: "team", label: "Team", reason: "Ownership, capacity and unclaimed work." },
  { id: "guidance", label: "Guidance", reason: "Programme boundaries and operational guidance." },
  { id: "reports", label: "Reports", reason: "Aggregate operational reporting." },
  { id: "service-stop", label: "Service stop", reason: "Stopping the whole service, and restarting it." },
  { id: "access-trail", label: "Access trail", reason: "Who opened which record, and when." },
  { id: "workload", label: "Workload", reason: "Work waiting across the team." },
  { id: "reconciliation", label: "Reconciliation", reason: "Differences between what was planned and what happened." },
  { id: "notifications", label: "Notifications", reason: "What the team is told, and how." },
  { id: "training", label: "Training", reason: "Practice mode, kept apart from real records." },
  { id: "coverage", label: "Coverage", reason: "Who is covering while someone is away." },
];

/**
 * The four width states of coordination design spec §7, made observable.
 *
 * The layout is pure Tailwind media classes and needs no JavaScript, but that
 * also means nothing in the DOM records which state is active — so a browser
 * proof would have had to re-derive the very breakpoints it is meant to check.
 * Exactly one of these markers is displayed at any width, which lets
 * `tests/ui-caring-contacts-workspace.spec.ts` compare the rendered state
 * against `widthStateFor()` itself rather than against a second copy of the
 * numbers.
 *
 * No named Tailwind breakpoint is used here. Tailwind's `xl` is 1280px, not the
 * frozen 1440, and design-system GATES §3b forbids adding a named
 * `--breakpoint-*` token for these states — so each range is written out.
 *
 * Each marker is `hidden` plus exactly ONE variant that turns it back on. The
 * obvious spelling — `hidden lg:block min-[1440px]:hidden` — is wrong, and wrong
 * silently: Tailwind sorts named breakpoints against each other, but an
 * arbitrary `min-[…]` variant is not guaranteed to be emitted after a named one,
 * so at 1440px `lg:block` won and both `split` and `wide` showed at once.
 * Variant-versus-base ordering is guaranteed; variant-versus-variant is not.
 * Caught by the browser proof at 1440px, the width the mapping exists for.
 *
 * The ranges use media-query range syntax so consecutive bounds MEET rather than
 * merely approach: `< 768px` and `768px <=` share an exact edge, where a
 * `max-[767.98px]` / `min-[768px]` pair would leave 767.98-768.00 showing no
 * marker at all. Integer widths never land there, but 400% zoom produces
 * fractional widths, and a width with no state would fail Task 19 confusingly
 * rather than usefully.
 */
const WIDTH_STATE_MARKERS: readonly { state: WorkspaceWidthState; className: string; label: string }[] = [
  { state: "compact", className: "hidden [@media_(width_<_768px)]:block", label: "Compact layout" },
  { state: "rail", className: "hidden [@media_(768px_<=_width_<_1024px)]:block", label: "Rail layout" },
  { state: "split", className: "hidden [@media_(1024px_<=_width_<_1440px)]:block", label: "Split layout" },
  { state: "wide", className: "hidden [@media_(width_>=_1440px)]:block", label: "Wide layout" },
];

export type CaringContactsShellProps = {
  /** The screen's own name; rendered as the one and only `h1`. */
  title: string;
  /** Optional plain-words statement of what this screen is for. */
  description?: string;
  /**
   * The service-wide safety stop, read from the store by the screen.
   *
   * REQUIRED, and required for a safety reason rather than a tidiness one
   * (Ruling 56). Spec §4.2 puts the banner on EVERY screen while a stop is
   * active, and "everywhere" is not a property that can rest on each page
   * author remembering an optional prop: a screen whose author forgot would
   * show no banner at all during a live stop, and a clinician would keep
   * working believing sending was fine. Making it required means the compiler
   * refuses a new screen that omits it.
   *
   * It must be a state the screen actually READ. Passing a literal
   * `{ stopped: false }` to satisfy the type would be worse than leaving the
   * prop optional — it would render a confident "service running" during an
   * incident.
   */
  serviceState: ServiceState;
  children: ReactNode;
};

const railItemClass =
  "flex min-h-tap w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-sm font-medium text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] motion-reduce:transition-none";

const phoneItemClass =
  "flex min-h-tap w-full min-w-0 flex-col items-center justify-center gap-1 px-1 text-2xs font-medium text-[color:var(--text-muted)]";

const morePanelItemClass =
  "flex min-h-tap w-full min-w-0 items-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-left text-sm font-medium text-[color:var(--text-muted)]";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * The Caring Contacts workspace shell.
 *
 * A Server Component by design. The four width states are expressed entirely in
 * Tailwind media classes, so the layout needs no JavaScript:
 *
 * | state   | width       | expression                                        |
 * | ------- | ----------- | ------------------------------------------------- |
 * | compact | below 768   | base — phone dock, no rail, one column            |
 * | rail    | 768-1023    | `md:` — icon rail, labels kept for screen readers |
 * | split   | 1024-1439   | `lg:` — labelled rail, More panel as a column     |
 * | wide    | 1440 and up | `min-[1440px]:` — the same split, wider measure   |
 *
 * `width-state.ts` holds the same boundaries as numbers for the overlay
 * modality decision; nothing here re-derives them.
 */
export function CaringContactsShell({ title, description, serviceState, children }: CaringContactsShellProps) {
  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-[color:var(--text)] md:flex">
      {WIDTH_STATE_MARKERS.map(({ state, className, label }) => (
        <span key={state} data-workspace-width-state={state} className={`sr-only ${className}`}>
          {label}
        </span>
      ))}

      <aside
        data-testid="caring-contacts-rail"
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface-chrome)] md:flex md:w-20 lg:w-64"
      >
        <div className="flex min-h-[var(--header-h)] items-center gap-3 border-b border-[color:var(--border)] px-4 lg:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
            <HeartHandshake aria-hidden="true" className="size-icon-lg" />
          </span>
          <span className="sr-only min-w-0 lg:not-sr-only">
            <span className="block truncate text-sm font-semibold text-[color:var(--text-heading)]">
              Caring Contacts
            </span>
          </span>
        </div>

        <nav aria-label="Workspace" className="mt-3 flex flex-1 flex-col gap-1 px-3">
          {PRIMARY_DESTINATIONS.map(({ id, label, href, icon: Icon, reason }) =>
            href ? (
              <Link key={id} href={href} data-internal-link="true" className={`${railItemClass} ${focusRing}`}>
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="truncate sr-only lg:not-sr-only">{label}</span>
              </Link>
            ) : (
              <UnavailableDestination
                key={id}
                id={`rail-${id}`}
                label={label}
                reason={reason}
                className={railItemClass}
              >
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="truncate sr-only lg:not-sr-only">{label}</span>
              </UnavailableDestination>
            ),
          )}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          id={WORKSPACE_HEADER_ID}
          data-synthetic-marker-host
          className="sticky top-0 z-[var(--z-raised)] border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-4 sm:px-6 lg:px-8 forced-colors:bg-[Canvas]"
        >
          <div className="flex min-h-[var(--header-h)] flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
                <HeartHandshake aria-hidden="true" className="size-icon-lg" />
              </span>
              <span className="truncate text-sm font-semibold text-[color:var(--text-heading)]">Caring Contacts</span>
            </div>
            <SyntheticMarker className="ml-auto" />
          </div>

          {/*
            The condensed statement of a service-wide stop, pinned under this header once the
            full banner below has scrolled out of view. It renders nothing while the service is
            running, and never at the same time as the banner. It lives INSIDE the header, and
            absolutely positioned, so it rides the sticky header without a second sticky element,
            without a magic offset the measured header height would not match, and without
            moving any content as it appears. See `service-state-banner.tsx`.
          */}
          <CondensedServiceStopBar state={serviceState} />
        </header>

        {/*
          Directly under the header, above the screen's own content, so a stop is
          the first thing read on every screen rather than something to scroll to.
          It renders nothing while the service is running.
        */}
        <ServiceStateBanner state={serviceState} />

        <main className="min-w-0 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 md:pb-8 lg:px-8">
          <div className="mx-auto w-full max-w-6xl min-[1440px]:max-w-[90rem]">
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8">
              <div className="min-w-0">
                <div className="mb-6 flex flex-col gap-4 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-balance text-hero font-semibold leading-display tracking-normal text-[color:var(--text-heading)]">
                      {title}
                    </h1>
                    {description ? (
                      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)] sm:text-base">
                        {description}
                      </p>
                    ) : null}
                  </div>
                  <UnavailableDestination
                    id="primary-new-plan"
                    label="New plan"
                    reason="Starting a caring-contact plan for a patient."
                    className="inline-flex min-h-tap shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text-muted)]"
                  >
                    <Plus aria-hidden="true" className="size-icon-md shrink-0" />
                    <span data-testid="caring-contacts-primary-control" className="truncate">
                      New plan
                    </span>
                  </UnavailableDestination>
                </div>
                {children}
              </div>

              <section
                id={MORE_DESTINATIONS_ID}
                aria-labelledby={`${MORE_DESTINATIONS_ID}-heading`}
                className="mt-10 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:mt-0"
              >
                <h2
                  id={`${MORE_DESTINATIONS_ID}-heading`}
                  className="text-sm font-semibold text-[color:var(--text-heading)]"
                >
                  More destinations
                </h2>
                <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
                  These destinations are planned. Each one states what it will hold once it is built.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {MORE_DESTINATIONS.map(({ id, label, reason }) => (
                    <li key={id} className="min-w-0">
                      <UnavailableDestination
                        id={`more-${id}`}
                        label={label}
                        reason={reason}
                        className={morePanelItemClass}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </main>
      </div>

      <nav
        aria-label="Phone workspace"
        data-testid="caring-contacts-phone-dock"
        className="fixed inset-x-0 bottom-0 z-[var(--z-chrome)] grid grid-cols-4 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] pb-[var(--safe-area-bottom)] md:hidden"
      >
        {PHONE_DESTINATIONS.map(({ id, label, href, icon: Icon, reason }) =>
          href ? (
            <Link key={id} href={href} data-internal-link="true" className={`${phoneItemClass} ${focusRing}`}>
              <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          ) : (
            <UnavailableDestination
              key={id}
              id={`phone-${id}`}
              label={label}
              reason={reason}
              className={phoneItemClass}
            >
              <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="truncate">{label}</span>
            </UnavailableDestination>
          ),
        )}
        {/*
          An in-page jump, not a route: the More panel is rendered in this same
          document, so this is deliberately a fragment anchor rather than a
          `<Link>`. The internal-navigation rule covers `href="/…"` targets.
        */}
        <a href={`#${MORE_DESTINATIONS_ID}`} className={`${phoneItemClass} ${focusRing}`}>
          <MoreHorizontal aria-hidden="true" className="size-icon-lg shrink-0" />
          <span className="truncate">More</span>
        </a>
      </nav>

      {/*
        The one renderer for all twenty-four overlays (Task 18), mounted once for
        the whole workspace rather than per screen — the interaction matrix is a
        workspace-wide contract, and a screen that forgot to mount it would lose
        the session gate and the offline notice with it.

        It takes no props: `WorkspaceOverlays` is the client boundary, and giving
        it none is what keeps `serviceState` on the server. It renders nothing at
        all until the URL carries `?overlay=<id>`.
      */}
      <WorkspaceOverlays />
    </div>
  );
}
