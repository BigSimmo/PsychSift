import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { cn } from "@/components/ui-primitives";

/**
 * The reserved space of a new work screen while its route loads: optional count tiles, an optional
 * hero block, then grey rows the height of the rows they stand in for, so nothing jumps when they
 * arrive. Static, no shimmer, so it needs nothing for reduced motion.
 */
export function WorkScreenLoading({
  label,
  testId,
  tiles = 0,
  hero = false,
  rows = 4,
}: {
  readonly label: string;
  readonly testId: string;
  readonly tiles?: number;
  readonly hero?: boolean;
  readonly rows?: number;
}) {
  const block = "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)]";
  return (
    <div
      role="status"
      aria-label={label}
      data-testid={testId}
      className="mx-auto grid w-full max-w-3xl gap-3 px-4 py-4"
    >
      {tiles ? (
        <div aria-hidden="true" className="grid grid-cols-3 gap-2">
          {Array.from({ length: tiles }, (_, index) => (
            <span key={index} className={cn(block, "h-16")} />
          ))}
        </div>
      ) : null}
      {hero ? <span aria-hidden="true" className={cn(block, "h-36")} /> : null}
      <ModeModuleSkeleton rows={rows} twoLine eyebrow />
      <ModeModuleSkeleton rows={2} twoLine eyebrow />
    </div>
  );
}
