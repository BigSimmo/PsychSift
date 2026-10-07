"use client";

import { Heart } from "lucide-react";
import { useId } from "react";

import { WorkIconCircle } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import {
  starrableWorkPages,
  toggleWorkPageStar,
  useWorkPageStars,
  workPageStarKey,
} from "@/lib/favourites/work-page-stars";

/**
 * Pick work pages to keep in Favourites, area by area. Each row is a toggle
 * that saves at once, so there is nothing to lose by closing the sheet.
 */
export function AddWorkPageSheet({
  open,
  onClose,
  returnFocusTarget,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusTarget?: () => HTMLElement | null;
}) {
  const stars = useWorkPageStars();
  const saved = new Set(stars.map((star) => workPageStarKey(star.areaId, star.itemId)));
  const headingId = useId();
  const groups = starrableWorkPages().filter((group) => group.items.length > 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a work page"
      description="Saved pages sit in Favourites and on My Day. They stay on this phone."
      closeLabel="Close add a work page"
      resolveReturnFocusTarget={returnFocusTarget}
      testId="add-work-page-sheet"
      bodyClassName="p-3 pb-6"
    >
      {/* Sheets render outside the page, so this sheet carries the work-mode
          tokens itself; on /favourites there is no work frame to inherit. */}
      <div data-work-frame="sheet" className="grid gap-4">
        {groups.map(({ area, items }) => (
          <section key={area.id} aria-labelledby={`${headingId}-${area.id}`} className="grid gap-1.5">
            <h3 id={`${headingId}-${area.id}`} className="work-label m-0">
              {area.name}
            </h3>
            <ul className="work-card work-rows" data-mode-identity={area.identity}>
              {items.map((item) => {
                const key = workPageStarKey(area.id, item.id);
                const on = saved.has(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => toggleWorkPageStar(area.id, item.id)}
                      className="work-row"
                      data-testid="add-work-page-row"
                    >
                      <WorkIconCircle icon={workFrameIcons[item.icon]} />
                      <span className="work-row__text">
                        <span className="work-row__title">{item.title ?? item.label}</span>
                        {item.sub ? <span className="work-row__sub">{item.sub}</span> : null}
                      </span>
                      <span className="work-row__end">
                        <Heart
                          aria-hidden="true"
                          strokeWidth={2}
                          className={cn(
                            "size-icon-md",
                            on ? "fill-current text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
                          )}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
