"use client";

export type NavigationGuard = () => boolean;

const guards = new Set<NavigationGuard>();

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** Returns false when a registered guard vetoes the navigation. */
export function canNavigate(): boolean {
  for (const guard of guards) {
    if (!guard()) return false;
  }
  return true;
}
