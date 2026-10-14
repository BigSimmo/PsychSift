"use client";

/** Best-effort client-side hint used to avoid unauthenticated roster probes. */
export function hasSupabaseAuthSession(): boolean {
  if (typeof document === "undefined") return false;
  if (/(?:^|;\s*)sb-[^=;]+-auth-token(?:[.\d]*)=/.test(document.cookie)) return true;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) return true;
    }
  } catch {
    // Ignore storage errors.
  }
  return false;
}
