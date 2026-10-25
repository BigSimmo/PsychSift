"use client";

import { ArrowRight, Search } from "lucide-react";
import type { FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn, searchShell, searchShellInput } from "@/components/ui-primitives";

/**
 * The tools directory's own filter box, ported from the retired `/?mode=tools` hub.
 *
 * `/tools` deliberately renders no shared composer — it owns its own filtering — but
 * until the hub was consolidated away this was the only place a clinician could type
 * a tools search, and the directory had no input at all. So the box came here rather
 * than being lost with the hub. (The hub's shortcut row, `ToolQuickActions`, was kept
 * as a component but is not rendered on `/tools`.)
 *
 * In-flow, never fixed: the search-chrome contract allows a page to own its filtering,
 * but not to stack a second dock-sized bar over the shared chrome.
 */
export function ToolLocalSearch({
  value,
  onChange,
  onSubmit,
  className,
}: {
  value: string;
  onChange: (query: string) => void;
  onSubmit: () => void;
  className?: string;
}) {
  return (
    <form
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(searchShell, "bg-[color:var(--surface-lux)] py-1.5 text-left shadow-[var(--e2)]", className)}
    >
      <span className="grid shrink-0 place-items-center text-[color:var(--text-muted)]">
        <Search className="size-icon-lg" aria-hidden />
      </span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Search tools</span>
        <input
          data-testid="tools-local-search-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search tools"
          className={cn(
            searchShellInput,
            "min-h-tap w-full text-sm font-medium text-[color:var(--text)] placeholder:text-[color:var(--text-placeholder)]",
          )}
        />
      </label>
      <button
        type="submit"
        aria-label="Search tools"
        data-testid="tools-local-search-submit"
        className={cn(buttonFaceClass({ variant: "primary", size: "sm" }), "h-tap w-tap shrink-0 px-0", focusRing)}
      >
        <ArrowRight className="size-icon-lg" aria-hidden />
      </button>
    </form>
  );
}
