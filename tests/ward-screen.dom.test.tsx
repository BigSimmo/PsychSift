import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Mirrors tests/ward-restriction-notice.test.ts's sibling dom suites (mode-nav.dom.test.tsx,
// ward-flow-clock-consistency.dom.test.tsx, ward-flow-queue-selection.dom.test.tsx):
// `ClinicalRail` renders next/link anchors and this suite never checks routing itself, so a
// plain <a> avoids requiring an App Router context jsdom cannot provide.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { useWardFlow, WardFlowProvider } from "@/components/ward-management/ward-flow-provider";
import { WardScreen } from "@/components/ward-management/ward/ward-screen";
import { movementById } from "@/components/ward-management/ward-movements";
import { NOW_ANCHOR, unitById } from "@/components/ward-management/ward-sites";

/**
 * Addendum R38: the brief's own chosen unit (`bty-adult-secure`) can never exercise a
 * restriction notice — its one live referral, WF-017, is Involuntary/Secure, and
 * `restrictionNotice` returns undefined for that pair (both levels require either an
 * Open-security movement or a Voluntary one against a Secure unit). Proving the notice actually
 * renders on this screen needs a pair that genuinely produces one.
 *
 * WF-301 is that pair, already measured and pinned against the real fixture in
 * `tests/ui-ward-coordinator.spec.ts`'s "gives a voluntary patient on a locked ward its own, more
 * prominent notice on the diagram" test: WF-301 is a Voluntary movement whose cohort (Adult)
 * shortlists exactly the three Secure adult wards, `rph-adult-secure` among them — verified below
 * again, independently, against the real fixture rather than assumed, so this test fails loudly
 * rather than silently no-op'ing if the fixture ever changes underneath it.
 *
 * WF-301 sits at `placement_requested` at seed (no live referral yet — the generated fixture's
 * `security: "Secure"` and `stage` both derive from `index % 7`, so a generated Secure movement
 * is always seeded at `placement_requested`, never already referred). A real `REFER_TO_UNITS`
 * dispatch — not a hand-authored fixture edit — creates the live referral, exactly the same
 * "dispatch a real event from a sibling, then read the target component again" technique
 * `tests/ward-flow-queue-selection.dom.test.tsx` uses to prove state is derived, not cached.
 */
const WF_301 = movementById("WF-301");
const RPH_ADULT_SECURE = unitById("rph-adult-secure");

function ReferWF301ToRphAdultSecure() {
  const { dispatch, now } = useWardFlow();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: "REFER_TO_UNITS",
          role: "coordinator",
          now,
          movementId: "WF-301",
          unitIds: ["rph-adult-secure"],
        })
      }
    >
      refer WF-301 to RPH Adult Secure
    </button>
  );
}

describe("ward screen restriction notice", () => {
  it("fixture assumption: WF-301 is Voluntary and RPH Adult Secure is Secure — the pair restrictionNotice flags", () => {
    // Guards the whole suite below: if either fact stops being true, every other assertion here
    // would either false-positive or silently stop covering the case it exists for.
    expect(WF_301?.legalStatus).toBe("Voluntary");
    expect(WF_301?.security).toBe("Secure");
    expect(RPH_ADULT_SECURE?.security).toBe("Secure");
  });

  it("renders the sharper voluntary-on-locked notice once this ward genuinely holds that referral", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <ReferWF301ToRphAdultSecure />
        <WardScreen unitId="rph-adult-secure" />
      </WardFlowProvider>,
    );

    // Before the referral: WF-301 does not yet hold a live referral anywhere, so RPH Adult
    // Secure's incoming list does not carry it.
    expect(screen.queryByTestId("ward-incoming-WF-301")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "refer WF-301 to RPH Adult Secure" }));

    // After a real REFER_TO_UNITS dispatch, WF-301 is a live incoming referral at this unit —
    // derived fresh from the provider's own `movements`, not a locally cached list.
    const incoming = screen.getByTestId("ward-incoming-WF-301");
    expect(incoming).toBeInTheDocument();

    const notice = screen.getByTestId("ward-restriction-notice-WF-301");
    expect(notice).toHaveTextContent("Voluntary patient on a locked ward — review legal status before admission");
    // The sharper level, distinguished by its own data attribute — never wording alone.
    expect(notice).toHaveAttribute("data-level", "voluntary_on_locked");
  });

  it("names bty-adult-secure's unresolved id when the route carries one, never a substituted ward", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <WardScreen unitId="does-not-exist-in-the-fixture" />
      </WardFlowProvider>,
    );
    expect(screen.getByTestId("ward-unit-screen")).toHaveTextContent("does-not-exist-in-the-fixture");
    expect(screen.queryByTestId("ward-unit-beds")).not.toBeInTheDocument();
  });
});

function ConfirmRphAdultSecureCapacityAtZero() {
  const { dispatch, now } = useWardFlow();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: "CONFIRM_CAPACITY",
          role: "ward",
          now,
          unitId: "rph-adult-secure",
          value: 0,
        })
      }
    >
      confirm rph-adult-secure capacity at zero
    </button>
  );
}

describe("ward screen live unit capacity", () => {
  it("resolves the unit from the provider's live units, not the frozen unitById() fixture", () => {
    // rph-adult-secure is seeded with allocatable.value 1 (pinned by
    // tests/ward-flow-reducer.test.ts's "writes the ward's restated allocatable count" case).
    const seededUnit = unitById("rph-adult-secure");
    expect(seededUnit?.allocatable.value).toBe(1);

    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <ConfirmRphAdultSecureCapacityAtZero />
        <WardScreen unitId="rph-adult-secure" />
      </WardFlowProvider>,
    );

    expect(screen.getByText(/Currently confirmed 1 at/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "confirm rph-adult-secure capacity at zero" }));

    // After a real CONFIRM_CAPACITY dispatch updates state.units, the screen must show the new
    // live count — resolving from the frozen fixture would keep showing 1 forever.
    expect(screen.getByText(/Currently confirmed 0 at/)).toBeInTheDocument();
  });
});
