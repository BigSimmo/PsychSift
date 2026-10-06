import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-[40rem] gap-3 px-3 pt-3">
      <OnCallCrisisLines />
      <ModeHomeRouteLoading />
    </div>
  );
}
