import { onCallTrack, onCallTrackFill } from "@/components/on-call/kit/calm";
import { cn } from "@/components/ui-primitives";

/**
 * On Call's thin progress track (mock-up v10): cover time used, an escalation
 * wait, a list ticked off. Decorative only; the words beside it carry the value.
 * The fill's width is the one genuinely dynamic style, kept in this one place.
 */
export function OnCallTrackBar({
  percent,
  className,
  fillClassName,
}: {
  readonly percent: number;
  readonly className?: string;
  readonly fillClassName?: string;
}) {
  const width = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return (
    <span aria-hidden="true" className={cn(onCallTrack, "block", className)}>
      <span className={cn(onCallTrackFill, fillClassName)} style={{ width: `${width}%` }} />
    </span>
  );
}
