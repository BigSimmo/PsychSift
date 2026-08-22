import { cn } from "@/components/ui-primitives";

/**
 * The safeguard wording, repeated verbatim from the frozen prototype baseline.
 *
 * It is redeclared here rather than imported: production may never import from
 * the frozen prototype tree, and `tests/caring-contact-route-files.test.ts`
 * holds that separation in both directions — including against a mere mention
 * of the prototype's path, which is why this comment names it in words only.
 *
 * The exact text is pinned by `tests/caring-contacts-workspace-shell.dom.test.tsx`,
 * on both sides of the workspace, the same way the prototype's copy is pinned by
 * `tests/caring-contact-product-redesign.dom.test.tsx`. Presence alone is not
 * enough: the wording could otherwise be changed to something that no longer
 * says the data is invented, and every gate would still pass.
 */
export const FICTIONAL_DATA_MARKER = "Synthetic prototype — fictional data only";

/**
 * Rendered as visible text on every screen of the workspace — not as a tooltip,
 * and not only on the shell. It is what makes listing a workspace of invented
 * patients in the live tools catalogue defensible, so the loading and error
 * states carry it too: a screenshot or printout of either should still say what
 * it is.
 *
 * `data-synthetic-marker` is a styling and safeguard hook, deliberately separate
 * from the test id, so the print rule in `globals.css` that keeps this visible
 * does not depend on a test hook.
 */
export function SyntheticMarker({ className }: { className?: string }) {
  return (
    <span
      data-synthetic-marker
      data-testid="caring-contacts-synthetic-marker"
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-2xs font-semibold text-[color:var(--clinical-accent)] sm:text-xs forced-colors:border-[CanvasText]",
        className,
      )}
    >
      {FICTIONAL_DATA_MARKER}
    </span>
  );
}
