"use client";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { toolIdentity } from "@/lib/category-identity";
import { categoryGlyph } from "@/lib/category-identity-icons";
import { localSmartExcludedToolIds, type ToolCatalogId, type ToolCatalogRecord } from "@/lib/tools-catalog";

/**
 * The verb shortcut row that used to live only on the `/?mode=tools` launcher.
 *
 * Tools had two surfaces: a hub at `/?mode=tools` carrying these shortcuts, and the
 * canonical directory at `/tools` carrying the filter ribbon and the full list. Which
 * one a clinician saw depended on how they arrived — the mode pill gave them the hub,
 * every other link gave them the directory. `/?mode=tools` now redirects to `/tools`,
 * and this row was kept rather than deleted with the hub: it is the one thing the hub
 * had that the directory did not.
 *
 * Not currently rendered. Nothing imports `ToolQuickActions`: the `/tools` directory
 * (`tools-search-results-page.tsx`) shows `ToolLocalSearch` and its results but no
 * shortcut row, and the launcher keeps its own copy of these actions. Whether the row
 * returns to `/tools` is an owner call; until then, do not read this file as proof that
 * the directory has shortcuts.
 *
 * Deliberately verbs, not mode names. The sidebar already lists every mode by name;
 * this row answers "what am I trying to do" (Ask, Compare, Prescribe, Safety), which
 * is a different question and the reason it is worth keeping at all.
 */
const quickActionsBase = [
  { label: "Ask", desktopLabel: "Ask evidence", id: "clinical-kb-search" },
  { label: "Compare", desktopLabel: "Compare", id: "differentials" },
  { label: "Prescribe", desktopLabel: "Prescribe", id: "medication-prescribing" },
  { label: "Safety", desktopLabel: "Safety check", id: "risk-safety" },
  { label: "Docs", desktopLabel: "Documents", id: "documents" },
  { label: "Refer", desktopLabel: "Refer", id: "services" },
  { label: "Forms", desktopLabel: "Forms", id: "forms" },
  { label: "Saved", desktopLabel: "Favourites", id: "favourites" },
] as const satisfies ReadonlyArray<{ label: string; desktopLabel: string; id: ToolCatalogId }>;

export function quickActionsForSession(canAccessFavourites: boolean, naturalSmartSearch: boolean) {
  return quickActionsBase.filter(
    (action) =>
      (canAccessFavourites || action.id !== "favourites") &&
      (!naturalSmartSearch || !localSmartExcludedToolIds.has(action.id)),
  );
}

// No fallback tool: borrowing another tool's identity and description for a
// missing id would pair one tool's label with a different tool's details.
function toolById(id: ToolCatalogId, tools: readonly ToolCatalogRecord[]) {
  return tools.find((tool) => tool.id === id);
}

export function ToolQuickActions({
  onSelect,
  mobile,
  tools,
  canAccessFavourites,
  naturalSmartSearch,
}: {
  onSelect: (id: ToolCatalogId) => void;
  mobile?: boolean;
  tools: readonly ToolCatalogRecord[];
  canAccessFavourites: boolean;
  naturalSmartSearch: boolean;
}) {
  // A shortcut whose tool is not in this catalogue is skipped rather than drawn
  // with another tool's details, so a filtered-to-nothing list renders no row.
  const quickActions = quickActionsForSession(canAccessFavourites, naturalSmartSearch).flatMap((action) => {
    const tool = toolById(action.id, tools);
    return tool ? [{ action, tool }] : [];
  });
  if (quickActions.length === 0) return null;
  return (
    <section
      aria-label="Quick tool shortcuts"
      className={cn(mobile ? "grid grid-cols-4 gap-2" : "grid w-full grid-cols-2 gap-3 md:grid-cols-3")}
    >
      {quickActions.slice(0, mobile ? 8 : 6).map(({ action, tool }) => {
        const identity = toolIdentity(tool.id, tool.area);
        return (
          <button
            key={action.label}
            type="button"
            aria-label={`Open ${action.desktopLabel}`}
            data-testid={`tool-shortcut-${action.id}`}
            onClick={() => onSelect(action.id)}
            className={cn(
              "group border border-[color:var(--border)] bg-[color:var(--surface-lux)] text-left shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-raised)]",
              focusRing,
              mobile
                ? "grid h-14 min-w-0 place-items-center gap-0.5 rounded-lg px-1 py-1.5 text-center"
                : "grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 py-2.5",
            )}
          >
            <span
              data-category-accent={identity.accent}
              className={cn(
                "grid place-items-center rounded-lg border border-[color:var(--cat-border)] bg-[color:var(--cat-soft)] text-[color:var(--cat-accent)] shadow-[var(--shadow-inset)] forced-colors:border",
                mobile ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              {categoryGlyph(identity.icon, mobile ? "size-icon-md" : "size-icon-lg")}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate font-bold leading-tight text-[color:var(--text-heading)]",
                  mobile ? "text-2xs" : "text-sm",
                )}
              >
                {mobile ? action.label : action.desktopLabel}
              </span>
              {!mobile ? (
                <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)] [overflow-wrap:anywhere]">
                  {tool.bestFor}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}
