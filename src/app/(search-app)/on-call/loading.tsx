import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-[40rem] gap-3 px-3 pt-3">
      <p role="status" className="text-sm text-[color:var(--text-muted)]">
        Loading this On Call page…
      </p>
      <OnCallCrisisLines />
      <ModeHomeRouteLoading />
    </div>
  );
}
