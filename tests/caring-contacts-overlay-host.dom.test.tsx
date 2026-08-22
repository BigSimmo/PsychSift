import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  blockReasonWording,
  dismissesOnEscapeOrBackdrop,
  NAMED_BLOCK_REASONS,
  OverlayHost,
} from "@/components/caring-contacts/workspace/overlays/overlay-host";
import { WORKSPACE_OVERLAY_DEFINITIONS } from "@/components/caring-contacts/workspace/overlays/definitions";
import {
  closeWorkspaceOverlay,
  openWorkspaceOverlay,
  WorkspaceOverlays,
} from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { WORKSPACE_WIDTH_BREAKPOINTS, widthStateFor } from "@/components/caring-contacts/workspace/width-state";

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

/**
 * Task 18: one renderer, twenty-four overlays.
 *
 * The frozen definition table in `overlays/definitions.ts` is the authority for
 * modality and dismissal. Nothing here re-derives either value, and nothing here
 * hard-codes a per-overlay expectation: every expectation below is read off the
 * table, so a renderer that quietly substitutes its own idea of a modality goes
 * red naming the row rather than passing on a copy that agrees with itself.
 */

function noop() {}

/**
 * jsdom reports a fixed 1024px viewport. The host reads `window.innerWidth`
 * through the shared `widthStateFor` mapping, so a test width is set the same
 * way the browser would report one — the property, then the event that tells a
 * subscriber it moved.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

/**
 * A named trigger plus the host, so focus return can be asserted against the
 * control that actually opened the overlay rather than against whatever jsdom
 * happened to leave focused.
 */
function OverlayHarness({ overlayId }: { overlayId: string }) {
  const [openOverlayId, setOpenOverlayId] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpenOverlayId(overlayId)}>
        Open the overlay
      </button>
      <OverlayHost
        openOverlayId={openOverlayId}
        onClose={() => setOpenOverlayId(null)}
        onCommit={noop}
        blockReason={null}
      />
    </>
  );
}

describe("the overlay host", () => {
  it("renders every one of the 24 overlays with its frozen modality at both widths", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [width, expected] of [
        [390, definition.phoneModality],
        [1440, definition.desktopModality],
      ] as const) {
        setViewportWidth(width);
        const { unmount } = render(
          <OverlayHost openOverlayId={definition.id} onClose={noop} onCommit={noop} blockReason={null} />,
        );
        const body = screen.getByTestId("workspace-overlay-content");
        expect(body, `${definition.id} at ${width}px`).toHaveAttribute("data-overlay-id", definition.id);
        expect(body, `${definition.id} at ${width}px`).toHaveAttribute("data-overlay-modality", expected);
        expect(body, `${definition.id} at ${width}px`).toHaveAttribute("data-overlay-dismissal", definition.dismissal);
        unmount();
      }
    }
  });

  /**
   * The definition table's own copy is guarded in
   * `tests/caring-contacts-overlay-definitions.test.ts`. This covers the words
   * the RENDERER adds on top of it — the checkpoint note, the refusal sentence,
   * the confirm label — which that test cannot see.
   *
   * Every overlay is rendered TWICE: once refused, which is the only state that
   * shows the refusal sentence, and once live, which is the only state from which
   * the fresh-authentication checkpoint can be reached at all. The checkpoint copy
   * was outside this check while it rendered only one of those states.
   */
  it("adds no prohibited vocabulary of its own to what it renders", async () => {
    let checkpointsCovered = 0;

    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      setViewportWidth(390);

      const refused = render(
        <OverlayHost
          openOverlayId={definition.id}
          onClose={noop}
          onCommit={noop}
          blockReason="permission-unavailable"
        />,
      );
      expect(
        screen.getByTestId("workspace-overlay-content").textContent ?? "",
        `${definition.id} renders prohibited wording while refused`,
      ).not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
      refused.unmount();

      const live = render(
        <OverlayHost openOverlayId={definition.id} onClose={noop} onCommit={noop} blockReason={null} />,
      );
      if (definition.requiresFreshAuthentication) {
        await userEvent.click(screen.getByTestId("workspace-overlay-action"));
        // Non-vacuous: the checkpoint copy is only in scope once it is on screen.
        expect(screen.getByText(/fresh authentication checkpoint/i)).toBeInTheDocument();
        checkpointsCovered += 1;
      }
      expect(
        screen.getByTestId("workspace-overlay-content").textContent ?? "",
        `${definition.id} renders prohibited wording while live`,
      ).not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
      live.unmount();
    }

    // The two fresh-authentication rows in the frozen table: withdrawal and reassignment.
    expect(checkpointsCovered).toBe(
      WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => definition.requiresFreshAuthentication).length,
    );
    expect(checkpointsCovered).toBe(2);
  });

  it("states every named refusal in plain words, and refuses to invent wording for one it has not been given", () => {
    // Ruling 61. The lookup is explicit and total; an unmapped key must be visible
    // rather than plausible, so there is no default branch to fall through to.
    expect(NAMED_BLOCK_REASONS.length).toBeGreaterThan(0);
    for (const reason of NAMED_BLOCK_REASONS) {
      const wording = blockReasonWording(reason);
      expect(wording, `${reason} is not a sentence`).toMatch(/^[A-Z].*\.$/);
      // The identifier itself must never reach the screen.
      expect(wording, `${reason} leaks its identifier`).not.toContain(reason);
      expect(wording, `${reason} uses prohibited wording`).not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    }

    expect(() => blockReasonWording("some-reason-nobody-wrote-wording-for")).toThrow(/Ruling 61/);

    // An object literal inherits from Object.prototype, so a bare `map[key]` lookup
    // answers `toString` and friends with a FUNCTION rather than `undefined` — which
    // walks straight past a `=== undefined` guard and renders as nothing at all: a
    // blocked control whose reason paragraph is empty. Exactly the "plausible instead
    // of visible" outcome Ruling 61 forbids, reached by inheritance rather than by a
    // default branch. Task 17 hit the identical defect in its matrix normalisation and
    // fixed it with `Object.hasOwn`; the fix has to be made again per lookup.
    for (const inherited of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
      expect(() => blockReasonWording(inherited), `${inherited} slipped past the guard`).toThrow(/Ruling 61/);
    }
  });

  /**
   * Minor 7: this branch is unreachable from the rendered component, because the
   * frozen table forbids `action-only` and a test that went through `OverlayHost`
   * could never reach it. An unproven guard on the conservative path is still an
   * unproven guard, so it is exercised directly.
   */
  it("refuses to guess at a dismissal value the frozen matrix does not express", () => {
    expect(dismissesOnEscapeOrBackdrop("escape-backdrop-close")).toBe(true);
    expect(dismissesOnEscapeOrBackdrop("recovery-only")).toBe(false);
    expect(() => dismissesOnEscapeOrBackdrop("action-only")).toThrow(/Ruling 58/);
  });

  /**
   * Ruling 60. `widthStateFor` switches compact→rail at 768; the shared `Sheet`
   * switches its mobile geometry to a centred dialog at Tailwind `sm:` = 640, in
   * CSS, with no prop to override it. So between 640 and 767 a `bottom-sheet` row
   * stamps `bottom-sheet` and renders as a dialog.
   *
   * That divergence is left in place deliberately — `sheet.tsx` is a design-system
   * component the whole application uses and `widthStateFor` is frozen design
   * non-regression — so this test exists to pin the BAND and name its cause, not to
   * assert the mismatch is desirable.
   *
   * BOTH edges are pinned, and they need different instruments. The rail edge is a
   * number this test can read (`WORKSPACE_WIDTH_BREAKPOINTS.rail`). The Sheet edge
   * is CSS: jsdom applies no Tailwind, so no rendered assertion can observe it, and
   * a bare `const SHEET_MOBILE_GEOMETRY_BREAKPOINT = 640` reads from nothing and
   * would stay green through any change to the shared component. So that edge is
   * held by SOURCE-TEXT assertions — the same instrument the client-boundary guard
   * in `caring-contacts-explained-automation.dom.test.tsx` already uses in this
   * codebase — over the two facts that together fix it at 640: the variant the Sheet
   * flips its default geometry on, and the absence of a `--breakpoint-sm` override
   * that would move what `sm:` means.
   */
  it("pins the 640–767 band where the stamped modality and the Sheet's own geometry breakpoint disagree", () => {
    const SHEET_MOBILE_GEOMETRY_BREAKPOINT = 640; // Tailwind `sm:`, held to that value below.

    // Edge one, the Sheet's: the exact default-placement class string that flips the
    // backdrop from bottom-aligned (phone) to centred (dialog). Moving that variant
    // to `md:` — or anywhere else — moves the band, and reddens this line.
    const sheetSource = readFileSync(resolve(process.cwd(), "src/components/ui/sheet.tsx"), "utf8");
    expect(
      sheetSource,
      "src/components/ui/sheet.tsx no longer flips its default geometry at `sm:` — the 640–767 band has moved",
    ).toContain('"items-end justify-center sm:items-center sm:p-6"');

    // ...and what `sm:` resolves to. Tailwind 4 lets an `@theme` block redefine a
    // breakpoint; `--breakpoint-sm` is absent, so `sm:` is still the default 640.
    // (`--breakpoint-phone: 640px` and friends are NAMED tokens added alongside the
    // defaults, not overrides of them.)
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(
      globalsSource,
      "an @theme --breakpoint-sm override now moves what `sm:` means, so 640 is no longer the Sheet's edge",
    ).not.toMatch(/--breakpoint-sm\s*:/);

    // Edge two, the contract's, read as a number rather than asserted as a literal.
    expect(WORKSPACE_WIDTH_BREAKPOINTS.rail).toBe(768);
    expect(SHEET_MOBILE_GEOMETRY_BREAKPOINT).toBeLessThan(WORKSPACE_WIDTH_BREAKPOINTS.rail);

    // Inside the band the contract still calls it compact, so a phone modality is
    // stamped even though the Sheet has already gone to desktop geometry.
    for (const width of [SHEET_MOBILE_GEOMETRY_BREAKPOINT, 700, WORKSPACE_WIDTH_BREAKPOINTS.rail - 1]) {
      expect(widthStateFor(width), `${width}px`).toBe("compact");
    }
    // Immediately outside it, on both sides, the two agree again.
    expect(widthStateFor(SHEET_MOBILE_GEOMETRY_BREAKPOINT - 1)).toBe("compact");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.rail)).toBe("rail");

    // Only `bottom-sheet` rows are affected: `full-screen-stage` keeps fullscreen
    // geometry to `lg:` (1024), right across the band.
    setViewportWidth(700);
    const bottomSheetRow = WORKSPACE_OVERLAY_DEFINITIONS.find(
      (definition) => definition.phoneModality === "bottom-sheet",
    );
    expect(bottomSheetRow, "the frozen table no longer has a bottom-sheet row").toBeDefined();
    render(<OverlayHost openOverlayId={bottomSheetRow!.id} onClose={noop} onCommit={noop} blockReason={null} />);
    expect(screen.getByTestId("workspace-overlay-content")).toHaveAttribute("data-overlay-modality", "bottom-sheet");
  });

  it("returns focus to the control that opened the overlay", async () => {
    setViewportWidth(1440);
    render(<OverlayHarness overlayId="pause" />);
    const trigger = screen.getByRole("button", { name: /open the overlay/i });

    await userEvent.click(trigger);
    expect(screen.getByTestId("workspace-overlay-content")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("workspace-overlay-content")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the session gate open through Escape", async () => {
    setViewportWidth(1440);
    const onClose = vi.fn();
    render(<OverlayHost openOverlayId="session-expiry" onClose={onClose} onCommit={noop} blockReason={null} />);
    await userEvent.keyboard("{Escape}");
    // The `onClose` assertion is the discriminating one, and it is the only one here.
    // A second line asserting the content is still in the document was REMOVED (Minor 5,
    // authorised): the host is uncontrolled in this test, `open` is hard-coded true, and
    // nothing the renderer could do would make that line fail.
    expect(onClose).not.toHaveBeenCalled();

    // The gate offers a recovery action and nothing that dismisses it: no close control,
    // which is the observable half of "recovery action only".
    expect(screen.queryByRole("button", { name: /^close$/i })).toBeNull();
  });

  it("puts opening focus on the recovery action of an overlay that cannot be dismissed", async () => {
    // WCAG 2.4.3. A `recovery-only` Sheet is given no `title`, so the shared Sheet renders no
    // header and its close-button fallback resolves to null. With no other focus hint in the panel
    // the opening focus lands on `document.body` -- on the ONE overlay a person cannot dismiss and
    // must act on, which a screen reader announces as nothing having happened at all.
    setViewportWidth(1440);
    render(<OverlayHost openOverlayId="session-expiry" onClose={noop} onCommit={noop} blockReason={null} />);

    const action = screen.getByTestId("workspace-overlay-action");
    await waitFor(() => expect(action).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("never traps focus in the offline status banner", () => {
    setViewportWidth(1440);
    render(<OverlayHost openOverlayId="offline-banner" onClose={noop} onCommit={noop} blockReason={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits a withdrawal only on the second activation", async () => {
    setViewportWidth(1440);
    const onCommit = vi.fn();
    render(<OverlayHost openOverlayId="withdrawal" onClose={noop} onCommit={onCommit} blockReason={null} />);
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/fresh authentication checkpoint/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("blocks a mutating overlay with a named reason but leaves a read-only overlay usable", async () => {
    setViewportWidth(1440);
    const onCommit = vi.fn();
    render(
      <OverlayHost openOverlayId="pause" onClose={noop} onCommit={onCommit} blockReason="permission-unavailable" />,
    );
    const action = screen.getByRole("button", { name: /pause/i });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).not.toHaveAttribute("disabled");
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    // Ruling 61: plain words, not the identifier. The exact mapped sentence, so a
    // future edit that reverted to rendering the key would go red here.
    expect(screen.getByText(blockReasonWording("permission-unavailable"))).toBeInTheDocument();
    expect(screen.getByTestId("workspace-overlay-content").textContent ?? "").not.toContain("permission-unavailable");
    await userEvent.click(action);
    expect(onCommit).not.toHaveBeenCalled();

    cleanup();
    const readOnlyCommit = vi.fn();
    render(
      <OverlayHost
        openOverlayId="message-preview"
        onClose={noop}
        onCommit={readOnlyCommit}
        blockReason="permission-unavailable"
      />,
    );
    expect(screen.getByRole("button", { name: /close/i })).not.toHaveAttribute("aria-disabled");
    // The read-only overlay's own action stays live too, not merely its close control.
    const readOnlyAction = screen.getByRole("button", { name: /back to personalisation/i });
    expect(readOnlyAction).not.toHaveAttribute("aria-disabled");
    await userEvent.click(readOnlyAction);
    expect(readOnlyCommit).toHaveBeenCalledTimes(1);
  });
});

/**
 * Rule 7's other half: the URL supports browser history, which means Back must
 * CLOSE an open overlay and must never walk forward into a dismissed one.
 */
describe("the overlay URL", () => {
  const WORKSPACE_PATH = "/caring-contacts";
  /**
   * The seeded prior entry deliberately has a DIFFERENT PATHNAME from the workspace.
   *
   * The first version of these tests seeded `/caring-contacts?marker=before` — same
   * pathname — and that made the deep-link test unable to discriminate: under
   * `replaceState` it ended at `/caring-contacts` with no `overlay=`, and under an
   * unconditional `history.back()` it ended at `/caring-contacts?marker=before`,
   * also with no `overlay=`, also pathname `/caring-contacts`, also with the overlay
   * closed by `popstate`. Every assertion passed either way. A distinct pathname is
   * what makes the two outcomes tell each other apart.
   */
  const PRIOR_PATH = "/caring-contacts/somewhere-before";

  /** Two distinguishable entries, so Back's destination is unambiguous. */
  function seedHistory() {
    window.history.pushState(null, "", `${PRIOR_PATH}?marker=before`);
    window.history.pushState(null, "", WORKSPACE_PATH);
    // No inherited marker: the workspace entry these tests start on was not pushed
    // by the module under test. The open/close branch is chosen per history ENTRY
    // from `history.state`, so there is no module-level flag to reset — but a
    // seeded entry carrying a stale marker would still make a test lie about which
    // branch it exercised, so it is asserted rather than assumed.
    expect(window.history.state, "the seeded workspace entry must carry no marker").toBeNull();
  }

  it("does not reopen a dismissed overlay when the browser goes back", async () => {
    setViewportWidth(1440);
    seedHistory();
    render(<WorkspaceOverlays />);

    act(() => openWorkspaceOverlay("pause"));
    await screen.findByTestId("workspace-overlay-content");
    expect(window.location.search).toContain("overlay=pause");

    act(() => closeWorkspaceOverlay());
    await waitFor(() => expect(screen.queryByTestId("workspace-overlay-content")).toBeNull());
    // Rule 7: closing removes the parameter.
    expect(window.location.search).not.toContain("overlay=");

    // The entry opening pushed was unwound rather than buried under a second push,
    // so Back lands on what preceded the workspace — not on the dismissed overlay.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe(PRIOR_PATH));
    expect(window.location.search).toContain("marker=before");
    expect(window.location.search).not.toContain("overlay=");
    expect(screen.queryByTestId("workspace-overlay-content")).toBeNull();
  });

  it("closes the overlay when the browser goes back from an open one", async () => {
    setViewportWidth(1440);
    seedHistory();
    render(<WorkspaceOverlays />);

    act(() => openWorkspaceOverlay("pause"));
    await screen.findByTestId("workspace-overlay-content");

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByTestId("workspace-overlay-content")).toBeNull());
    expect(window.location.search).not.toContain("overlay=");
  });

  it("removes the parameter without leaving the workspace when the overlay came from a deep link", async () => {
    setViewportWidth(1440);
    seedHistory();
    // Nobody pushed this entry: it is how the page was arrived at. `replaceState`
    // with a null state also clears any marker, which is what makes this the
    // deep-link case rather than an inherited one.
    window.history.replaceState(null, "", `${WORKSPACE_PATH}?overlay=pause`);
    expect(window.history.state, "the deep-linked entry must carry no marker").toBeNull();
    render(<WorkspaceOverlays />);
    expect(screen.getByTestId("workspace-overlay-content")).toBeInTheDocument();

    act(() => closeWorkspaceOverlay());
    await waitFor(() => expect(screen.queryByTestId("workspace-overlay-content")).toBeNull());
    expect(window.location.search).not.toContain("overlay=");

    // Replaced, NOT unwound. This is the discriminating pair, and it needs both
    // halves: the seeded prior entry has a DIFFERENT pathname, so an unconditional
    // `back()` would already have moved us there — the first assertion catches it —
    // and the second proves that entry is still one Back away rather than consumed.
    expect(window.location.pathname).toBe(WORKSPACE_PATH);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe(PRIOR_PATH));
  });
});
