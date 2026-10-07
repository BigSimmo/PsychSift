"use client";

import { Heart } from "lucide-react";

import { useWorkUndoToast } from "@/components/mode-kit/work";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import {
  isWorkPageStarred,
  restoreWorkPageStars,
  toggleWorkPageStar,
  useWorkPageStars,
  workPageStarKey,
  type WorkPageStar,
} from "@/lib/favourites/work-page-stars";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Adds the current work page to Favourites, or takes it off. One heart, the
 * same one clinical pages use, so "saved" looks the same everywhere. Drawn
 * round and glass because it floats in the frame's header corner.
 */
export function WorkPageFavouriteButton({
  areaId,
  itemId,
  pageName,
  className,
}: {
  readonly areaId: WorkAreaId;
  readonly itemId: string;
  /** Spoken in the label and toast ("Renewals"). */
  readonly pageName: string;
  readonly className?: string;
}) {
  const stars = useWorkPageStars();
  const key = workPageStarKey(areaId, itemId);
  const saved = stars.some((star) => workPageStarKey(star.areaId, star.itemId) === key);
  const undoToast = useWorkUndoToast();
  const toast = useOptionalToast();

  function toggle() {
    const before: WorkPageStar | undefined = stars.find((star) => workPageStarKey(star.areaId, star.itemId) === key);
    const result = toggleWorkPageStar(areaId, itemId);
    if (!result.saved) {
      toast?.push({
        tone: "danger",
        title: "This phone did not save that",
        body: "Storage is blocked or full in this browser.",
      });
      return;
    }
    const message = result.starred ? `${pageName} added to Favourites` : `${pageName} removed from Favourites`;
    undoToast?.(message, () => {
      if (result.starred) {
        if (isWorkPageStarred(areaId, itemId)) toggleWorkPageStar(areaId, itemId);
      } else if (before) {
        restoreWorkPageStars([before]);
      }
    });
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${pageName} from Favourites` : `Add ${pageName} to Favourites`}
      onClick={toggle}
      data-testid="work-page-favourite-button"
      className={cn("work-glass-button", className)}
    >
      <Heart
        aria-hidden="true"
        strokeWidth={2}
        className={cn("size-icon-md", saved ? "fill-current text-[color:var(--mode-identity)]" : undefined)}
      />
    </button>
  );
}
