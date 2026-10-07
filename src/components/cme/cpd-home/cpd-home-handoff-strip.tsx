import { Award, ExternalLink, FileSpreadsheet } from "lucide-react";

import { cn } from "@/components/ui-primitives";

export type HandoffFileState = "none" | "making" | "saved";

/**
 * The signature of "Send to AMA CPD Home": your log, then the CSV file that
 * works today, then CPD Home drawn dashed, because what it can import has not
 * been checked. One picture, read as one sentence by a screen reader.
 */
export function CpdHomeHandoffStrip({
  activities,
  file,
}: {
  readonly activities: number;
  readonly file: HandoffFileState;
}) {
  const activityWords = `${activities} ${activities === 1 ? "activity" : "activities"}`;
  return (
    <div
      role="img"
      data-testid="cpd-home-handoff"
      aria-label={`Your log of ${activityWords} goes into a CSV file${file === "saved" ? ", saved" : file === "making" ? ", being made" : ""}. What AMA CPD Home can import is not checked yet.`}
      className="relative grid grid-cols-3 py-1"
    >
      <span
        aria-hidden="true"
        className="absolute left-[16.7%] right-1/2 top-6 h-0.5 rounded-full bg-[color:var(--mode-identity-border)]"
      />
      <span
        aria-hidden="true"
        className="absolute left-1/2 right-[16.7%] top-6 border-t-2 border-dashed border-[color:var(--border-strong)]"
      />
      <Node icon={Award} title="Your log" sub={activityWords} state="done" />
      <Node
        icon={FileSpreadsheet}
        title="CSV file"
        sub={file === "saved" ? "Saved" : file === "making" ? "Making" : "Not made yet"}
        state={file === "saved" ? "done" : file === "making" ? "current" : "open"}
      />
      <Node icon={ExternalLink} title="CPD Home" sub="To confirm" state="unchecked" />
    </div>
  );
}

function Node({
  icon: Icon,
  title,
  sub,
  state,
}: {
  readonly icon: typeof Award;
  readonly title: string;
  readonly sub: string;
  readonly state: "done" | "current" | "open" | "unchecked";
}) {
  return (
    <span aria-hidden="true" className="relative z-[var(--z-raised)] grid justify-items-center gap-0.5 text-center">
      <span
        className={cn(
          "mb-1 grid size-11 place-items-center rounded-full bg-[color:var(--surface-raised)]",
          state === "done" &&
            "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
          state === "current" &&
            "border-2 border-[color:var(--mode-identity)] bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]",
          state === "open" && "border-2 border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
          state === "unchecked" &&
            "border-2 border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-icon-md" />
      </span>
      <span className="text-sm font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
      <span
        className={cn(
          "text-xs leading-4",
          state === "unchecked" ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]",
        )}
      >
        {sub}
      </span>
    </span>
  );
}
