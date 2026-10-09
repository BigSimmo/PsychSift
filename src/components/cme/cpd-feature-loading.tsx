import { cmePageWidth } from "@/components/cme/cme-page-frame";
import { cn } from "@/components/ui-primitives";

const SHAPES = ["h-6", "h-24", "h-16", "h-40"] as const;

/** The loading shapes for the new CPD pages: no words but the screen-reader label, and no numbers. */
export function CpdFeatureLoading({ label }: { readonly label: string }) {
  return (
    <main className={cn(cmePageWidth, "grid gap-4 px-4 pt-4 sm:px-6")} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {SHAPES.map((height) => (
        <div
          key={height}
          aria-hidden="true"
          className={cn(
            height,
            "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] motion-safe:animate-pulse",
          )}
        />
      ))}
    </main>
  );
}
