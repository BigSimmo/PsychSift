/**
 * The DOM anchor a group on an On Call page carries, so the in-page header can
 * jump to it.
 *
 * One function rather than a literal per section, because the header's declared
 * section ids and the rendered `id` attributes have to be the same string or the
 * jump silently lands nowhere. `tests/in-page-nav-route-sections.dom.test.tsx`
 * asserts anchors against rendered DOM for exactly this reason — never by
 * grepping for `id=`.
 */
export function onCallGroupAnchorId(slug: string): string {
  return `on-call-group-${slug}`;
}

/** A group heading turned into a stable, lowercase anchor fragment. */
export function onCallGroupSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "group";
}

/**
 * A unique slug for this label among those already allocated.
 *
 * `onCallGroupSlug` is many-to-one: "ED / General" and "ED General" both become
 * `ed-general`. Groups stay separate — they are different owner-typed labels —
 * so the header and the heading have to receive different ids as well, or both
 * jump targets collapse onto the first matching element.
 *
 * Callers share one `taken` set per page so the declaration
 * (`on-call-page-sections.ts`) and the rendered `id` stay the same string.
 */
export function allocateOnCallGroupSlug(label: string, taken: Set<string>): string {
  const base = onCallGroupSlug(label);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/** Stable record identity, independent of editable titles, slugs and grouping. */
export function onCallEntryAnchorId(id: string): string {
  return `on-call-entry-${id}`;
}

export function focusOnCallEntryFromHash(): void {
  focusOnCallEntryHashTarget();
}

/** `focusOnCallEntryFromHash`, returning whether the hashed entry was on the page. */
export function focusOnCallEntryHashTarget(): boolean {
  if (typeof window === "undefined") return false;
  const id = window.location.hash.slice(1);
  if (!id.startsWith("on-call-entry-")) return false;
  const target = document.getElementById(id);
  if (!target) return false;
  const disclosure = target.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  disclosure?.click();
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "center", behavior: "instant" });
  return true;
}
