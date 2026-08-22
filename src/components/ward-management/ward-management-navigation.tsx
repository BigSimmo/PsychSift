"use client";

import Link from "next/link";
import {
  Activity,
  Ambulance,
  BedSingle,
  Building2,
  CircleAlert,
  FileCheck2,
  HeartPulse,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  MessageSquarePlus,
  Pill,
  Route,
  Settings,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Truck,
  Waypoints,
  Wrench,
} from "lucide-react";

import { BrandMark } from "@/components/clinical-dashboard/brand";

import shellStyles from "./ward-management.module.css";
import modeStyles from "./ward-management-modes.module.css";
import { WardRoleSwitcher } from "./ward-role-switcher";

export type WardMode =
  "command" | "network" | "queue" | "capacity" | "movements" | "exceptions" | "transport" | "governance";

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={active ? shellStyles.railLinkActive : shellStyles.railLink}
    >
      {children}
    </Link>
  );
}

/**
 * Task 9 (controller Ruling 4): the owner's own instruction — "you are your own application
 * inside of it... you are able to use the side bar to place all of your headings" — moved the
 * eight Ward Flow mode links out of the horizontal `WardModeNavigation` strip that used to sit
 * below the header on every route, and into this rail. `ClinicalRail` is defined in this file
 * (not the global app shell), so it is Ward Flow's own to extend rather than a shared surface
 * this task would be overreaching to touch.
 *
 * `activeMode` is optional: the patient workspace route (`/ward-management/patients/[id]`) is
 * not one of the eight modes, so it renders the rail without the mode section at all rather than
 * forcing an arbitrary "active" choice.
 */
export function ClinicalRail({ activeMode }: { activeMode?: WardMode } = {}) {
  return (
    <aside className={shellStyles.clinicalRail} aria-label="Clinical KB">
      <Link href="/" className={shellStyles.railBrand} aria-label="Clinical KB home">
        <BrandMark className={shellStyles.brandGlyph} />
      </Link>
      <div className={shellStyles.railRule} aria-hidden="true" />
      <nav className={shellStyles.railNav} aria-label="Clinical applications">
        <RailLink href="/?mode=answer" label="Clinical Answers">
          <MessageSquarePlus aria-hidden="true" />
        </RailLink>
        <RailLink href="/ward-management" label="Ward Flow" active>
          <Activity aria-hidden="true" />
        </RailLink>
        <RailLink href="/documents" label="Documents">
          <FileCheck2 aria-hidden="true" />
        </RailLink>
        <RailLink href="/services" label="Services">
          <SlidersHorizontal aria-hidden="true" />
        </RailLink>
        <RailLink href="/medications" label="Medication">
          <Pill aria-hidden="true" />
        </RailLink>
        <RailLink href="/tools" label="Tools">
          <Wrench aria-hidden="true" />
        </RailLink>
        <RailLink href="/tools" label="All applications">
          <LayoutGrid aria-hidden="true" />
        </RailLink>
      </nav>
      {activeMode ? (
        <>
          <div className={shellStyles.railRule} aria-hidden="true" />
          <WardModeNavigation active={activeMode} />
        </>
      ) : null}
      <div className={shellStyles.railBottom}>
        {/* Task 12: the role switcher — the one control the proof journey (spec §14) uses to
            move between all four roles without ever reloading the page. Placed first among the
            Ward-Flow-specific shortcuts below since, unlike the three static ones after it, its
            destination is dynamic (inferred from whichever patient the coordinator last
            selected — see `ward-role-switcher.tsx`'s own doc comment). */}
        <WardRoleSwitcher />
        <div className={shellStyles.railRule} aria-hidden="true" />
        {/* Task 8: the ward screen's own route (`/ward-management/ward/[unitId]`) is not one of
            the eight `WardModeNavigation` links above — that nav's own Playwright test
            (`tests/ui-ward-management.spec.ts`) asserts an exact count of 8 links, so a ninth
            entry there would break it. This is a literal, static href (never built from a
            variable or a loop) so `tests/route-reachability.test.ts`'s AST scan can find it —
            see that test's comment and R39c. RPH Adult Secure is a real, resolvable unit id. */}
        <RailLink href="/ward-management/ward/rph-adult-secure" label="Ward — RPH Adult Secure">
          <Building2 aria-hidden="true" />
        </RailLink>
        {/* Task 9: unlike the ward link immediately above, `/ward-management/transport/officer`
            is a STATIC route (no `[unitId]`-style bracket segment), so it falls inside
            `tests/route-reachability.test.ts`'s scanned scope rather than being exempt as a
            dynamic detail route. That scanner's AST walk only registers a JSX element literally
            named `Link` (imported from `next/link`) whose OWN `href` attribute is a string
            literal — `RailLink` below passes `href` through as a destructured prop, so a
            `RailLink`-wrapped href reads as a plain `Identifier` to the scanner, not a literal,
            and stays invisible to it (confirmed: swapping this back to `<RailLink href="...">`
            reproduces the orphan-route failure this comment exists to prevent — see the task
            report). This is a raw `<Link>`, not `RailLink`, for exactly that reason. Labelled
            "Officer" rather than "Transport officer": Playwright's default accessible-name match
            is a substring match, and the eight-mode strip already has a "Transport" link (the
            live tracker, `/ward-management/transport`) — a name containing "Transport" makes
            `getByRole("link", { name: "Transport" })` resolve to two elements and breaks
            `tests/ui-ward-management.spec.ts`'s existing "opens every Ward Flow mode" walk, which
            is not scoped by exact match (also confirmed by running that spec). */}
        <Link
          href="/ward-management/transport/officer"
          aria-label="Officer"
          title="Officer"
          className={shellStyles.railLink}
        >
          <Ambulance aria-hidden="true" />
        </Link>
        {/* Task 11: `/ward-management/ed/[edId]` is a dynamic detail route, same shape as the
            ward link above — a raw `<Link>` with a literal string `href`, not `RailLink`, for the
            exact reason documented on the Officer link immediately above: `RailLink` passes
            `href` through as a destructured prop, which reads as a plain `Identifier` to
            `tests/route-reachability.test.ts`'s AST scan and stays invisible to it. Peel is a
            real, resolvable emergency department id. Labelled "Emergency department" — checked
            against every other accessible name in this rail and `WardModeNavigation` below, none
            of which contain that string as a substring, so Playwright's default substring
            accessible-name match cannot collide with it the way "Transport officer" once did. */}
        <Link
          href="/ward-management/ed/peel-ed"
          aria-label="Emergency department"
          title="Emergency department"
          className={shellStyles.railLink}
        >
          <Siren aria-hidden="true" />
        </Link>
        <RailLink href="/?mode=answer" label="Favourites">
          <HeartPulse aria-hidden="true" />
        </RailLink>
        <RailLink href="/tools" label="Settings">
          <Settings aria-hidden="true" />
        </RailLink>
        <span className={shellStyles.avatar} aria-label="Guest workspace">
          G
        </span>
      </div>
    </aside>
  );
}

/**
 * The mode strip renders one literal `<Link href="...">` per view (never built from an array)
 * so `tests/route-reachability.test.ts` can find every href by static AST scan, and
 * `tests/ward-management.test.ts`'s `wardModeHrefs()` can read them back by scanning this
 * function's own source text — see that test's comment. Rendered icon-only inside `ClinicalRail`
 * now (Task 9 Ruling 4); each link still carries its own accessible name via `aria-label` since
 * its only visible content is an icon.
 */
export function WardModeNavigation({ active }: { active: WardMode }) {
  return (
    <nav className={modeStyles.modeNavigation} aria-label="Ward Flow views">
      <Link
        href="/ward-management"
        aria-label="Command"
        title="Command"
        aria-current={active === "command" ? "page" : undefined}
        className={active === "command" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <LayoutDashboard aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/network"
        aria-label="Network"
        title="Network"
        aria-current={active === "network" ? "page" : undefined}
        className={active === "network" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <Waypoints aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/queue"
        aria-label="Priority queue"
        title="Priority queue"
        aria-current={active === "queue" ? "page" : undefined}
        className={active === "queue" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <ListFilter aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/capacity"
        aria-label="Capacity"
        title="Capacity"
        aria-current={active === "capacity" ? "page" : undefined}
        className={active === "capacity" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <BedSingle aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/movements"
        aria-label="Movements"
        title="Movements"
        aria-current={active === "movements" ? "page" : undefined}
        className={active === "movements" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <Route aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/exceptions"
        aria-label="Exceptions"
        title="Exceptions"
        aria-current={active === "exceptions" ? "page" : undefined}
        className={active === "exceptions" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <CircleAlert aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/transport"
        aria-label="Transport"
        title="Transport"
        aria-current={active === "transport" ? "page" : undefined}
        className={active === "transport" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <Truck aria-hidden="true" />
      </Link>
      <Link
        href="/ward-management/governance"
        aria-label="Governance"
        title="Governance"
        aria-current={active === "governance" ? "page" : undefined}
        className={active === "governance" ? shellStyles.railLinkActive : shellStyles.railLink}
      >
        <ShieldCheck aria-hidden="true" />
      </Link>
    </nav>
  );
}
