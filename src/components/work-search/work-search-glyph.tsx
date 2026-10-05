import { Search, Sparkle } from "lucide-react";

import { cn } from "@/components/ui-primitives";

/** The magnifier with a small sparkle: the mark for "Search my work", never the clinical search. */
export function WorkSearchGlyph({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-grid shrink-0 place-items-center", className)}>
      <Search aria-hidden="true" className="size-full" />
      <Sparkle aria-hidden="true" className="absolute -right-1 -top-1 size-[45%] fill-current" />
    </span>
  );
}
