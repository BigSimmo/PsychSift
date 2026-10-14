import { MapPin } from "lucide-react";

import { privacyToneSurface, privacyToneText } from "@/components/privacy/tone";
import { cn } from "@/components/ui-primitives";
import { PRIVACY_PROCESSING_MAP } from "@/lib/privacy-page-content";

/**
 * Calm processing journey: stacked at phone width, three equal stages from
 * tablet upward. Soft tone washes + MapPin marks; never horizontal pills that
 * force the payload into unreadably narrow columns.
 *
 * Each cell now carries what actually travels there. Naming the payload is the
 * difference between a label and a map: "External / OpenAI API" says nothing
 * about whether the thing you just typed is in it.
 */
export function ProcessingMap({ density = "comfortable" }: { density?: "comfortable" | "compact" }) {
  const compact = density === "compact";
  return (
    <section aria-label="Where processing happens" className={cn(compact ? "space-y-1.5" : "space-y-2")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-xs font-semibold text-[color:var(--text-muted)]">Processing map</p>
        <p className="text-3xs font-medium text-[color:var(--text-muted)]">Operator must verify regions</p>
      </div>
      <div
        data-testid="privacy-processing-stages"
        className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--border)] shadow-[var(--shadow-inset)] sm:grid-cols-3"
      >
        {PRIVACY_PROCESSING_MAP.map((cell) => (
          <div
            key={cell.place}
            className={cn(
              "relative min-w-0",
              compact ? "px-3 py-3 sm:py-3.5" : "px-2.5 py-2.5 sm:px-4 sm:py-3.5",
              privacyToneSurface[cell.tone],
            )}
          >
            <div className={cn("flex items-start", compact ? "gap-1" : "gap-1.5")}>
              <MapPin
                aria-hidden="true"
                className={cn(
                  "mt-0.5 shrink-0 opacity-80",
                  compact ? "h-3 w-3" : "h-3.5 w-3.5",
                  privacyToneText[cell.tone],
                )}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-bold",
                    compact ? "text-xs leading-4" : "text-xs leading-4 sm:text-sm sm:leading-5",
                    privacyToneText[cell.tone],
                  )}
                >
                  {cell.place}
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-semibold tracking-display text-[color:var(--text-heading)]",
                    compact ? "text-2xs leading-4" : "text-2xs leading-4 sm:text-sm sm:leading-5",
                  )}
                >
                  {cell.role}
                </p>
                <p className="mt-1 text-3xs leading-4 text-[color:var(--text-muted)]">{cell.carries}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-3xs leading-4 text-[color:var(--text-muted)]">
        Question text and selected excerpts can leave Australia.
      </p>
    </section>
  );
}
