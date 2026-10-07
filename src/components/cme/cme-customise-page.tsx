"use client";

import { ArrowDown, ArrowUp, Check, EyeOff, Lock } from "lucide-react";
import { useRouter } from "next/navigation";

import { CmeDetailNavHeader } from "@/components/cme/cme-nav-header";
import { CmeHint } from "@/components/cme/cme-work-kit";
import { WorkBody } from "@/components/mode-kit/work";
import { cn, IconButton, toolbarButton } from "@/components/ui-primitives";
import {
  cmeDashboardModuleIds,
  canMoveModule,
  cmeDashboardModuleLabels,
  cmeDashboardModuleSubtitles,
  useCmeModuleOrder,
  type CmeDashboardModuleId,
} from "@/lib/cme/module-order";

const ROW_CONTROL = cn(toolbarButton, "min-h-12 min-w-12");

/**
 * The screen that lets the owner reorder and hide the CME dashboard's
 * modules — everything below its three always-shown rows (the total-hours
 * figure, the pace sentence, and the next action).
 *
 * Reordering is never drag-only: every row offers an up and a down control,
 * each a real `<button>`, so moving a module works from a keyboard exactly as
 * well as from a pointer.
 *
 * Nothing here reads or writes anything but the owner's own layout
 * preference — no requirement, entry or routine is touched on this page.
 */
export function CmeCustomisePage() {
  const { moduleIds, toggleModule, moveModule } = useCmeModuleOrder();
  const hiddenModuleIds = cmeDashboardModuleIds.filter((moduleId) => !moduleIds.includes(moduleId));
  const router = useRouter();

  return (
    <>
      {/* Every change saves as it is made, so Done only leaves, back to the
          Year page, where the new order shows. */}
      <CmeDetailNavHeader
        title="Customise"
        back={{ href: "/cme", label: "Year" }}
        primaryAction={{ label: "Done", icon: Check, onClick: () => router.push("/cme") }}
        testIdPrefix="cme-customise"
      />
      <main data-mode-identity="cme" data-testid="cme-customise" className="w-full">
        <WorkBody>
          <h1 className="sr-only">Customise your Year page</h1>

          <section aria-labelledby="cme-module-top-heading" className="grid gap-1.5">
            <h2 id="cme-module-top-heading" className="work-label m-0">
              Always on top
            </h2>
            <div className="work-card work-row">
              <span className="work-ic" aria-hidden="true">
                <Lock aria-hidden="true" strokeWidth={1.8} />
              </span>
              <span className="work-row__text">
                <span className="work-row__title">Hours, pace and next step</span>
                <span className="work-row__sub">The hero and the first row of What&apos;s left</span>
              </span>
            </div>
          </section>

          <section aria-labelledby="cme-module-order-heading" className="grid gap-1.5">
            <h2 id="cme-module-order-heading" className="work-label m-0">
              Shown
            </h2>
            {moduleIds.length === 0 ? (
              <div className="work-card work-card--pad">
                <p data-testid="cme-module-order-empty" className="work-row__sub m-0">
                  Nothing is shown below your hours, your pace and your next step. Bring one back below.
                </p>
              </div>
            ) : (
              <ul role="list" data-testid="cme-module-order" className="work-card work-rows m-0 p-0">
                {moduleIds.map((moduleId) => {
                  const label = cmeDashboardModuleLabels[moduleId];
                  return (
                    <li key={moduleId} className="work-row min-w-0 list-none gap-1 py-1 pr-1">
                      <span className="work-row__text break-words">
                        <span className="work-row__title min-w-0 break-words">{label}</span>
                        <span className="work-row__sub">{cmeDashboardModuleSubtitles[moduleId]}</span>
                      </span>
                      <IconButton
                        icon={ArrowUp}
                        label={`Move ${label} up`}
                        disabled={!canMoveModule(moduleIds, moduleId, -1)}
                        onClick={() => moveModule(moduleId, -1)}
                        className={ROW_CONTROL}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`Move ${label} down`}
                        disabled={!canMoveModule(moduleIds, moduleId, 1)}
                        onClick={() => moveModule(moduleId, 1)}
                        className={ROW_CONTROL}
                      />
                      <IconButton
                        icon={EyeOff}
                        label={`Hide ${label}`}
                        onClick={() => toggleModule(moduleId)}
                        className={ROW_CONTROL}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <CmeHint>
              Use the arrows to reorder. A section can only move past others in its own part of the Year page.
            </CmeHint>
          </section>

          {hiddenModuleIds.length > 0 ? (
            <section aria-labelledby="cme-module-order-hidden-heading" className="grid gap-1.5">
              <h2 id="cme-module-order-hidden-heading" className="work-label m-0">
                Hidden
              </h2>
              <ul role="list" data-testid="cme-module-order-hidden" className="work-card work-rows m-0 p-0">
                {hiddenModuleIds.map((moduleId: CmeDashboardModuleId) => {
                  const label = cmeDashboardModuleLabels[moduleId];
                  return (
                    <li key={moduleId} className="work-row min-w-0 list-none">
                      <span className="work-row__text">
                        <span className="work-row__title min-w-0 break-words text-[color:var(--work-ink-muted)]">
                          {label}
                        </span>
                        <span className="work-row__sub">{cmeDashboardModuleSubtitles[moduleId]}</span>
                      </span>
                      <button
                        type="button"
                        className="work-button min-h-tap shrink-0"
                        data-variant="tinted"
                        onClick={() => toggleModule(moduleId)}
                        aria-label={`Show ${label}`}
                      >
                        Show
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <CmeHint>Changes save as you make them.</CmeHint>
        </WorkBody>
      </main>
    </>
  );
}
