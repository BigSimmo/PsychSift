import { AlertTriangle, LoaderCircle, LockKeyhole, SearchX } from "lucide-react";

import type { DifferentialRequestStatus } from "@/components/clinical-dashboard/use-differential-catalog";

type DifferentialContentKind = "diagnosis" | "presentation";

function stateCopy(status: Exclude<DifferentialRequestStatus, "ready">, kind: DifferentialContentKind) {
  const subject = kind === "diagnosis" ? "differential diagnosis" : "differential presentation";
  if (status === "loading") {
    return {
      title: `Loading ${subject}`,
      description: "Checking the current public clinical release.",
      Icon: LoaderCircle,
    };
  }
  if (status === "unauthorized") {
    return {
      title: "Sign in to view this differential",
      description: "Your session could not be verified. Sign in again, then reopen this page.",
      Icon: LockKeyhole,
    };
  }
  if (status === "not_found") {
    return {
      title: kind === "diagnosis" ? "Differential diagnosis not found" : "Differential presentation not found",
      description: "This item is not available in the current public clinical release.",
      Icon: SearchX,
    };
  }
  if (status === "unavailable") {
    return {
      title: "Differential content unavailable",
      description: "The public clinical release is updating or temporarily unavailable. Try again shortly.",
      Icon: AlertTriangle,
    };
  }
  return {
    title: kind === "diagnosis" ? "Could not load differential diagnosis" : "Could not load differential presentation",
    description: "An unexpected error prevented this clinical content from loading. Try again shortly.",
    Icon: AlertTriangle,
  };
}

export function DifferentialContentState({
  status,
  kind,
}: {
  status: Exclude<DifferentialRequestStatus, "ready">;
  kind: DifferentialContentKind;
}) {
  const { title, description, Icon } = stateCopy(status, kind);
  const loading = status === "loading";
  return (
    <main
      className="grid min-h-[50dvh] place-items-center bg-[color:var(--background)] px-4 py-12 text-[color:var(--text)]"
      role={loading ? "status" : "alert"}
      aria-live={loading ? "polite" : "assertive"}
      aria-busy={loading || undefined}
    >
      <div className="w-full max-w-lg rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-center shadow-[var(--shadow-soft)]">
        <Icon
          className={`mx-auto h-7 w-7 text-[color:var(--clinical-accent)] ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
          aria-hidden
        />
        <h1 className="mt-3 text-xl font-extrabold text-[color:var(--text-heading)]">{title}</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{description}</p>
      </div>
    </main>
  );
}
