import { Skeleton, searchPageShell, searchPageContainer } from "@/components/ui-primitives";

export default function Loading() {
  return (
    <div className={searchPageShell} role="status" aria-label="Loading differentials">
      <div className={searchPageContainer}>
        <Skeleton className="mb-4 h-8 w-48 rounded-lg" />
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 w-full max-w-80 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
        <Skeleton className="mb-6 h-12 w-full rounded-xl" animationDelay="50ms" />
        <div className="grid gap-4">
          <Skeleton className="h-28 w-full rounded-2xl" animationDelay="100ms" />
          <Skeleton className="h-64 w-full rounded-2xl" animationDelay="150ms" />
          <Skeleton className="h-36 w-full rounded-2xl" animationDelay="200ms" />
        </div>
      </div>
      <span className="sr-only">Loading differentials</span>
    </div>
  );
}
