"use client";

import { ArrowDown, ArrowUp, Check, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";

import { cardSurface } from "@/components/card-recipes";
import { CmeDetailNavHeader } from "@/components/cme/cme-nav-header";
import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { cn, eyebrowText, IconButton, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  cmeDashboardModuleIds,
  canMoveModule,
  cmeDashboardModuleLabels,
  useCmeModuleOrder,
  type CmeDashboardModuleId,
} from "@/lib/cme/module-order";

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
      {/* Every change saves as it is made, so Done only leaves — back to Today,
          where the new order shows. */}
      <CmeDetailNavHeader
        title="Customise"
        back={{ href: "/cme", label: "Year" }}
        primaryAction={{ label: "Done", icon: Check, onClick: () => router.push("/cme") }}
        testIdPrefix="cme-customise"
      />
      <main className={cn(cmePageWidth, "px-4 py-6 sm:px-6")}>
        <h1 className={cmePageTitle}>Customise your dashboard</h1>
        <p className={cn(textMuted, "mt-1 text-sm")}>
          Choose what shows below your hours, your pace and your next action, and put it in the order you want. Order
          applies within each section of Today, so a module can only move past others in its own section.
        </p>

        <section aria-labelledby="cme-module-order-heading" className="mt-6">
          <h2 id="cme-module-order-heading" className={eyebrowText}>
            Shown on your dashboard
          </h2>
          {moduleIds.length === 0 ? (
            <p data-testid="cme-module-order-empty" className={cn(textMuted, "mt-2 text-sm")}>
              Nothing is shown below your hours, your pace and your next action. Bring one back below.
            </p>
          ) : (
            <ul data-testid="cme-module-order" className="mt-2 space-y-2">
              {moduleIds.map((moduleId) => {
                const label = cmeDashboardModuleLabels[moduleId];
                return (
                  <li key={moduleId} className={cn(cardSurface, "flex items-center justify-between gap-2 p-3")}>
                    <span className="min-w-0 break-words text-sm font-medium text-[color:var(--text)]">{label}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconButton
                        icon={ArrowUp}
                        label={`Move ${label} up`}
                        disabled={!canMoveModule(moduleIds, moduleId, -1)}
                        onClick={() => moveModule(moduleId, -1)}
                        className={toolbarButton}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`Move ${label} down`}
                        disabled={!canMoveModule(moduleIds, moduleId, 1)}
                        onClick={() => moveModule(moduleId, 1)}
                        className={toolbarButton}
                      />
                      <IconButton
                        icon={EyeOff}
                        label={`Hide ${label}`}
                        onClick={() => toggleModule(moduleId)}
                        className={toolbarButton}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {hiddenModuleIds.length > 0 ? (
          <section aria-labelledby="cme-module-order-hidden-heading" className="mt-6">
            <h2 id="cme-module-order-hidden-heading" className={eyebrowText}>
              Hidden
            </h2>
            <ul data-testid="cme-module-order-hidden" className="mt-2 space-y-2">
              {hiddenModuleIds.map((moduleId: CmeDashboardModuleId) => {
                const label = cmeDashboardModuleLabels[moduleId];
                return (
                  <li key={moduleId} className={cn(cardSurface, "flex items-center justify-between gap-2 p-3")}>
                    <span className={cn(textMuted, "min-w-0 break-words text-sm")}>{label}</span>
                    <IconButton
                      icon={Eye}
                      label={`Show ${label}`}
                      onClick={() => toggleModule(moduleId)}
                      className={toolbarButton}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
