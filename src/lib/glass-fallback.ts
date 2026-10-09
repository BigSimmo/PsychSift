/**
 * Glass fallback: decides, before first paint, whether the floating glass
 * controls (header buttons, mode pill, dock, sheets) should drop their
 * backdrop blur and wear a plain tint instead.
 *
 * Blur is the costliest thing the work frame paints. On a low-end Android
 * phone it re-samples the page under every glass layer on each scroll frame,
 * which is where the stutter comes from. CSS alone covers two cases
 * (`@supports not (backdrop-filter)` and `prefers-reduced-transparency`, see
 * work-mode.css). This covers the third, which CSS cannot see: a phone with
 * little memory or few cores. It sets `data-glass="flat"` on <html>, and the
 * work-mode tokens swap the blur for a near-opaque fill, so the layout and
 * colours stay the same.
 *
 * Kept tiny and dependency-free because it runs inline in the root layout.
 */

/** Device memory in GB, as Chrome buckets it (0.25 to 8). Absent elsewhere. */
type DeviceHints = {
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

/** True when the device is too weak for live backdrop blur. */
export function shouldFlattenGlass(hints: DeviceHints): boolean {
  const memory = hints.deviceMemory;
  const cores = hints.hardwareConcurrency;
  if (typeof memory === "number" && memory > 0 && memory <= 2) return true;
  if (typeof cores === "number" && cores > 0 && cores <= 2) return true;
  return false;
}

/**
 * The inline pre-paint script. Mirrors shouldFlattenGlass exactly; the unit
 * test runs this string against the same cases so the two cannot drift.
 */
export const GLASS_FALLBACK_SCRIPT = `(function(){try{var n=navigator,m=n.deviceMemory,c=n.hardwareConcurrency;if((typeof m==="number"&&m>0&&m<=2)||(typeof c==="number"&&c>0&&c<=2)){document.documentElement.setAttribute("data-glass","flat");}}catch(e){/* navigator hints unavailable - keep the glass */}})();`;
