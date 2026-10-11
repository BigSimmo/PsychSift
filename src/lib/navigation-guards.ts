/**
 * A tiny registry of "may we leave this page?" checks for shell controls that navigate with
 * `router.push` (the mode menu, New chat), which no link click or `beforeunload` ever sees.
 *
 * A page with unsaved work registers a guard while it is dirty (the safety plan asks with
 * `window.confirm`); a shell control calls `confirmShellNavigation()` before pushing and does
 * nothing when it returns false. Guards are expected to ask at most once per user action.
 */
export type NavigationGuard = () => boolean;

const guards = new Set<NavigationGuard>();

/** Adds a guard; the returned function removes it again. */
export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** False when any registered guard says stay; later guards are then not asked. */
export function confirmShellNavigation(): boolean {
  for (const guard of guards) {
    if (!guard()) return false;
  }
  return true;
}
