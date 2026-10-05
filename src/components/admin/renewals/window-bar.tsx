/**
 * The renewal window as one thin bar (5 Oct mock-up v2, screens 1 and 9): the
 * elapsed share from the day renewing opens to the recorded date, and a line
 * at today. Drawn as SVG attributes, so it needs no inline style. Decorative:
 * the dates under it, and the date line above, say the same in words.
 */
export function AdminWindowBar({ progress, className }: { readonly progress: number; readonly className?: string }) {
  const at = Math.min(Math.max(progress, 0), 1) * 100;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      className={className ?? "block h-2 w-full overflow-visible"}
    >
      <rect
        x="0"
        y="2"
        width="100"
        height="4"
        rx="2"
        className="fill-[color:var(--surface-inset)] forced-colors:fill-[GrayText]"
      />
      <rect
        x="0"
        y="2"
        width={at}
        height="4"
        rx="2"
        className="fill-[color:var(--text-muted)] forced-colors:fill-[CanvasText]"
      />
      <rect
        x={Math.max(at - 0.6, 0)}
        y="0"
        width="1.2"
        height="8"
        className="fill-[color:var(--clinical-accent)] forced-colors:fill-[Highlight]"
      />
    </svg>
  );
}
