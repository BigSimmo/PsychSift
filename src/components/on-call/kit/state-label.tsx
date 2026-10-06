import { modeDot } from "@/components/mode-kit/recipes";
import { ON_CALL_WITHDRAWN_MESSAGE } from "@/components/on-call/use-hospital-handbook";
import { cn } from "@/components/ui-primitives";
import { formatOnCallTime } from "@/lib/on-call/display-dates";

/**
 * A row's state, as muted words with a dot of 6px or less — never a filled chip
 * on a row (standard §3; pre-flight D1). The words always say the state, so the
 * dot is never the only signal. Amber is kept for the one real warning, a
 * removed number; "Not set up" and "Not recorded" are muted grey.
 */
export type OnCallRowState =
  | { readonly kind: "not-set-up" }
  | { readonly kind: "not-recorded" }
  | { readonly kind: "removed" }
  | { readonly kind: "didnt-connect"; readonly at: string }
  | { readonly kind: "reported" }
  | { readonly kind: "saved-copy"; readonly savedAt: string };

function words(state: OnCallRowState): string {
  switch (state.kind) {
    case "not-set-up":
      return "Not set up for this hospital";
    case "not-recorded":
      return "Not recorded";
    case "removed":
      return ON_CALL_WITHDRAWN_MESSAGE;
    case "didnt-connect":
      return `Didn't connect at ${formatOnCallTime(state.at)}`;
    case "reported":
      return "Reported";
    case "saved-copy":
      return `Saved copy from ${formatOnCallTime(state.savedAt)}`;
  }
}

export function OnCallStateLabel({ state }: { readonly state: OnCallRowState }) {
  const warning = state.kind === "removed";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
      <span
        aria-hidden="true"
        data-state-dot=""
        className={cn(modeDot, warning ? "bg-[color:var(--warning)]" : "bg-[color:var(--border-strong)]")}
      />
      <span className="break-words">{words(state)}</span>
    </span>
  );
}
