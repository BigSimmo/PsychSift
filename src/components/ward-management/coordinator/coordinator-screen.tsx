"use client";

import { useLayoutEffect, useMemo, useState } from "react";

import { buildActionInbox, isOpen } from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";
import { queueOrder } from "@/components/ward-management/ward-priority";
import { allEmergencyDepartments } from "@/components/ward-management/ward-sites";

import styles from "./coordinator.module.css";
import { ExceptionDrawer } from "./exception-drawer";
import { FlowDiagram } from "./flow-diagram";
import { PressureStrip } from "./pressure-strip";
import { PriorityQueue } from "./priority-queue";
import { ShortlistPanel } from "./shortlist-panel";

/**
 * Task 3 shell: five landmark regions, all present and stubbed with real synthetic volume
 * (`edPressure` returns 8 departments, `queueOrder` returns 41 open movements) so the layout is
 * judged against real volume rather than three placeholder rows. Task 4 built out the pressure
 * strip and the queue's department filter; Task 5 built the real `PriorityQueue`; Task 6 built
 * the real `FlowDiagram`; Task 7 built the real `ShortlistPanel`; Task 8 built the real
 * `ExceptionDrawer` and the phone form.
 */

// Must match the `@media (max-width: 48rem)` breakpoint in coordinator.module.css that hides
// `.diagramRegion` and `.pressureStrip`. CSS already hides the diagram visually on first paint
// (server-rendered markup cannot know the viewport), but Task 8 review Minor 5 found the
// underlying `FlowDiagram` still MOUNTED underneath that `display: none` — its `useLayoutEffect`,
// `ResizeObserver` and window-resize `measure()` all kept running against a zero-size box. This
// query drives whether `FlowDiagram` mounts at all, so a phone stops paying for work nobody can
// see rather than merely hiding the result of it.
const PHONE_DIAGRAM_MEDIA_QUERY = "(max-width: 48rem)";

export function CoordinatorScreen() {
  // Task 5: the screen's props stop being derived from the frozen `wardMovements` fixture and
  // `NOW_ANCHOR` constant and start coming from the shared provider (`WardFlowProvider`, already
  // wrapping every `/ward-management` route via `src/app/ward-management/layout.tsx`). `units`
  // is not destructured here — nothing this screen renders yet reads live unit state, and an
  // unused destructured value would be dead weight rather than real wiring.
  const { movements, rejections, now, dispatch, focusMovementId, setFocusMovementId } = useWardFlow();
  // Task 12: seeded from the shared `focusMovementId` (not always `undefined`) so a coordinator
  // who switched away to answer a referral as another role and switches back finds the same
  // patient still selected — this screen remounts on every route change (it is a route
  // segment under the persistent `WardFlowProvider` layout, not the layout itself), so a plain
  // `useState(undefined)` would otherwise forget the selection on every round trip. See
  // `ward-flow-provider.tsx`'s doc comment on `focusMovementId` for why this lives in the shared
  // context rather than only here.
  //
  // Restored only while that movement is still OPEN. Found while reviewing the journey's own
  // final screenshot: an arrived movement is never reachable through the queue (`queueOrder`
  // filters to `isOpen` before this screen ever renders a row for it to click), so restoring the
  // selection unconditionally re-selected WF-315 after its own arrival and left the shortlist
  // showing "Currently at ARM" / "waiting in the emergency department" for a patient who had, in
  // fact, already left the department — stale copy for a record this screen has no other way to
  // select. Gating on `isOpen` keeps the restore doing its actual job (surviving a role switch
  // mid-journey) without inventing a selection path a live click could never produce.
  const [selectedMovementId, setSelectedMovementId] = useState<string | undefined>(() => {
    const restored = focusMovementId ? movements.find((movement) => movement.id === focusMovementId) : undefined;
    return restored && isOpen(restored) ? restored.id : undefined;
  });
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const [selectedEdId, setSelectedEdId] = useState<string | undefined>(undefined);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  // SSR and the first client paint must agree (matchMedia is unavailable on the server), so this
  // starts false — the same "assume desktop, correct after mount" convention
  // `usesPhoneSearchLayout` uses in master-search-header.tsx. `useLayoutEffect` (not `useEffect`)
  // keeps the window where `FlowDiagram` is needlessly mounted on a real phone as short as
  // possible — synchronously before the browser paints, rather than after.
  const [isPhoneDiagramLayout, setIsPhoneDiagramLayout] = useState(false);

  useLayoutEffect(() => {
    const phoneMedia = window.matchMedia(PHONE_DIAGRAM_MEDIA_QUERY);
    const sync = () => setIsPhoneDiagramLayout(phoneMedia.matches);
    sync();
    phoneMedia.addEventListener("change", sync);
    return () => phoneMedia.removeEventListener("change", sync);
  }, []);

  // Task 8 review Important 3 named the real constraint: on a phone, the full explainable
  // shortlist (candidates, all eight eligibility gates, every decline, the score breakdown) is
  // real, long content that does not fit above the fold on a 390px screen, so Confirm has to stay
  // reachable in one tap rather than a scroll a coordinator has to go looking for. This used to be
  // solved with a double-`requestAnimationFrame` `scrollIntoView` effect here, because the control
  // could land off-screen below the fold and the fix had to MEASURE where the scroll container had
  // settled after a resize (`.main`'s grid rows and `.screen`'s `100dvh` height had not always
  // finished resolving to the new viewport at the moment a single rAF ran — measured landing 256px
  // short on some runs, which is why a second rAF was nested on top of it).
  //
  // Task 7 replaces that with `.shortlistActionRow` pinned to the literal viewport bottom by CSS
  // on phone widths (`coordinator.module.css`, `@media (max-width: 48rem)`). A CSS-pinned bar
  // cannot land off-screen, so it never measures `.main`'s grid or `.screen`'s height — the exact
  // thing the deleted effect's comment named as the race it was working around. That race
  // dissolves rather than needing a replacement fix here.

  // Whole-branch review Critical 2, second half. Confirm now requires an explicit unit selection,
  // but `selectedUnitId` is screen-level state that outlived the movement it was chosen for: pick
  // a ward for patient A, then select patient B from the queue, and B inherited A's selection with
  // Confirm already available against it. That is the same defect the panel-level fix closes, just
  // sourced from a selection made for a different patient rather than from `shortlist[0]`. A unit
  // choice belongs to the movement it was made against, so changing movement clears it.
  function selectMovement(movementId: string | undefined) {
    setSelectedMovementId(movementId);
    setSelectedUnitId(undefined);
    // Task 12: mirrored into the shared context so `WardRoleSwitcher` — rendered on every
    // ward-management route, not just this one — can infer a Ward/ED destination for whichever
    // patient was last selected here, even after a role switch has unmounted this screen.
    setFocusMovementId(movementId);
  }

  // The provider's own `movements` array — never `movementById`, which reads the frozen fixture
  // and would never see a referral this screen just dispatched. An id the live array cannot
  // resolve still renders as `undefined` (Task 6 conservative-failure rule), so no fallback is
  // threaded through here.
  const selectedMovement = selectedMovementId
    ? movements.find((movement) => movement.id === selectedMovementId)
    : undefined;

  const selectedEd = selectedEdId ? allEmergencyDepartments().find((ed) => ed.id === selectedEdId) : undefined;
  // A `selectedEdId` this lookup cannot name must not leave the queue silently filtered with no
  // notice and no Clear control (Task 4 review Minor 8) — fall back to "nothing selected" rather
  // than substituting a record or keeping a filter active that can't be described on screen.
  const activeEdId = selectedEd?.id;
  // A one-line filter, not a derivation: it keys on a field the model already carries
  // (`Movement.originEdId`), so it belongs here rather than in a ward-*.ts module.
  const filteredMovements = activeEdId ? movements.filter((movement) => movement.originEdId === activeEdId) : movements;
  const queue = queueOrder(filteredMovements, now);

  // The exception inbox is the coordinator's global work list, not a view scoped to whatever ED
  // filter the queue happens to have selected — a breached legal deadline at a filtered-out
  // department must not silently drop off the work list just because the queue is filtered.
  // `movements` and `now` are both live now (Task 5), not constants, so this must recompute
  // whenever either changes rather than caching a single mount-time snapshot forever.
  //
  // Whole-branch review Minor 6: the inbox is scoped to OPEN movements. `buildActionInbox` has no
  // `isOpen` guard of its own and `movements` carries all 48 records including the 7 closed
  // ones, so passing the raw array put an arrived or did-not-proceed patient's breached deadline
  // on a live work list. Latent on today's fixture — no closed movement currently qualifies for
  // any of the three categories — but it is precisely the shape of Phase 1's "48 open movements"
  // defect, which was also a closed record counted as live.
  const actionInbox = useMemo(() => buildActionInbox(movements.filter(isOpen), now), [movements, now]);

  return (
    <div className={styles.screen} data-testid="ward-coordinator">
      <ClinicalRail activeMode="command" />
      <div className={styles.main}>
        <h1 className="sr-only">Ward Flow coordinator</h1>

        <div className={styles.governanceBanner} data-testid="ward-coordinator-governance">
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
          <p>
            This screen is <strong>not a medical device</strong>. It orders operational placement work only — it never
            assesses a patient&apos;s risk, acuity or treatment. A human coordinator confirms or overrides every
            suggestion.
          </p>
        </div>

        <div className={styles.body} data-testid="ward-coordinator-body">
          <PressureStrip now={now} selectedEdId={selectedEdId} onSelectEd={setSelectedEdId} />

          <div className={styles.regionGrid} data-testid="ward-coordinator-region-grid">
            <PriorityQueue
              movements={queue}
              now={now}
              selectedId={selectedMovementId}
              onSelect={selectMovement}
              filterEdId={activeEdId}
              onClearFilter={() => setSelectedEdId(undefined)}
            />

            <section className={styles.diagramRegion} aria-label="Statewide flow">
              <header className={styles.regionHeader}>
                <h2>Statewide flow</h2>
                {selectedUnitId ? (
                  <button
                    type="button"
                    className={styles.clearSelectionButton}
                    onClick={() => setSelectedUnitId(undefined)}
                  >
                    Clear unit selection
                  </button>
                ) : null}
              </header>
              {/* Task 8 review Minor 5: `.diagramRegion` is already hidden by CSS below 48rem;
                  this stops `FlowDiagram` from mounting there too, rather than only painting
                  over its (still-running) ResizeObserver and layout-effect work. */}
              {isPhoneDiagramLayout ? null : (
                <FlowDiagram
                  movement={selectedMovement}
                  now={now}
                  selectedUnitId={selectedUnitId}
                  onSelectUnit={(unitId) => setSelectedUnitId((current) => (current === unitId ? undefined : unitId))}
                />
              )}
            </section>

            <div className={styles.shortlistColumn}>
              <aside className={styles.shortlistRegion} aria-label="Explainable shortlist">
                <header className={styles.regionHeader}>
                  <h2>Explainable shortlist</h2>
                </header>
                <ShortlistPanel
                  movement={selectedMovement}
                  now={now}
                  selectedUnitId={selectedUnitId}
                  onSelectUnit={(unitId) => setSelectedUnitId((current) => (current === unitId ? undefined : unitId))}
                  dispatch={dispatch}
                />
              </aside>
            </div>
          </div>
        </div>

        <ExceptionDrawer
          items={actionInbox}
          rejections={rejections}
          open={exceptionsOpen}
          onToggle={() => setExceptionsOpen((open) => !open)}
          // Task 8 review Important 3: on a phone the open drawer's own panel is what stands
          // between a coordinator and Confirm — selecting an exception has done the drawer's
          // job (a movement is now chosen), so it closes itself in the same tap rather than
          // leaving a coordinator to scroll past it to reach the shortlist underneath.
          onSelectMovement={(movementId) => {
            selectMovement(movementId);
            setExceptionsOpen(false);
          }}
        />
      </div>
    </div>
  );
}
