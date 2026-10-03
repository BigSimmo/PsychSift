import { cn } from "@/components/ui-primitives";
import type { AppModeResultKind } from "@/lib/app-modes";

type ModeHomeCanvasClassInput = {
  activeModeResultKind: AppModeResultKind;
  centeredModeHome: boolean;
  compactMobileModeHome: boolean;
  hasAnswer: boolean;
  showSharedHome: boolean;
  /**
   * Top-align the shared home instead of centring it. Set for a signed-in
   * reader, whose home can grow a My Day card below the composer after load:
   * in a centred column that late card would lift the hero and composer
   * (layout shift, a mis-tap risk). Top-aligned, the card only adds space
   * below. Owner decision 2026-10-03.
   */
  topAlignSharedHome?: boolean;
};

/**
 * Keeps the shared dashboard's phone-home geometry outside the render monolith.
 * The flex column fills the already-padded main pane, while only centred homes
 * gain flex centring. Registry homes retain their previous top alignment.
 *
 * At `sm` and above the canvas grows into the content wrapper rather than
 * claiming `calc(100dvh - <estimate>)`. The wrapper is `sm:flex sm:min-h-full
 * sm:flex-col` (ClinicalDashboard), and `min-h-full` there resolves against
 * `#main-content` — a bounded scrollport with a definite height — so the
 * remaining space is exact. The old `calc(100dvh-11rem)` floor had to guess the
 * header block, the wrapper's own `py`/`pb`, the desktop composer slot and the
 * `space-y` gap in one number; it was 46px short at `lg` and 38px short at `sm`,
 * which put a permanent scroll range on every mode home that had nothing to
 * scroll. `grow` + `shrink-0` mirrors the phone treatment below: grow into free
 * space, never compress, so a tall page still scrolls normally.
 */
/**
 * The shared home top-aligns for a signed-in reader. While the session is still
 * resolving (cold load) it already top-aligns, so the first paint and the
 * signed-in paint agree and the composer does not jump.
 */
export function topAlignSharedHomeForAuth(status: string): boolean {
  return status === "authenticated" || status === "loading";
}

export function resolveModeHomeCanvasClass({
  activeModeResultKind,
  centeredModeHome,
  compactMobileModeHome,
  hasAnswer,
  showSharedHome,
  topAlignSharedHome = false,
}: ModeHomeCanvasClassInput): string {
  const topAligned = topAlignSharedHome && showSharedHome;
  return cn(
    compactMobileModeHome
      ? cn(
          "max-sm:flex max-sm:grow max-sm:shrink-0 max-sm:flex-col sm:grow sm:shrink-0",
          centeredModeHome && !topAligned && "max-sm:items-center max-sm:justify-center",
          topAligned && "max-sm:items-center max-sm:justify-start",
        )
      : activeModeResultKind === "answer" && hasAnswer
        ? "sm:grow sm:shrink-0"
        : // The phone floor stays a viewport calc: below `sm` the document owns
          // scrolling and this canvas has no bounded scrollport to fill.
          "min-h-[calc(100dvh-12.5rem)] sm:grow sm:shrink-0",
    centeredModeHome || showSharedHome
      ? topAligned
        ? compactMobileModeHome
          ? "w-full sm:grid sm:content-start sm:justify-items-center"
          : "grid w-full content-start justify-items-center max-sm:pt-2"
        : compactMobileModeHome
          ? "w-full sm:grid sm:place-items-center"
          : "grid w-full place-items-center max-sm:pt-2"
      : activeModeResultKind === "tools" ||
          activeModeResultKind === "favourites" ||
          activeModeResultKind === "differentials"
        ? "mx-auto w-full max-w-6xl space-y-4 overflow-x-hidden"
        : activeModeResultKind === "documents" ||
            activeModeResultKind === "services" ||
            activeModeResultKind === "forms"
          ? "mx-auto w-full max-w-6xl space-y-4 overflow-x-hidden"
          : "mx-auto w-full max-w-3xl space-y-4 overflow-x-hidden",
  );
}
