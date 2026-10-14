import { Skeleton, searchPageShell, searchPageContainer } from "@/components/ui-primitives";

export default function Loading() {
  return (
    <div className={searchPageShell} role="status" aria-label="Loading medication">
      <div className={searchPageContainer}>
        <Skeleton className="mb-4 h-8 w-48 rounded-lg" />
        <Skeleton className="mb-6 h-10 w-full max-w-96 rounded-lg" animationDelay="50ms" />
        <Skeleton className="mb-6 h-28 w-full rounded-2xl" animationDelay="100ms" />
        <Skeleton className="mb-6 h-12 w-full rounded-xl" animationDelay="150ms" />
        <Skeleton className="h-72 w-full rounded-2xl" animationDelay="200ms" />
      </div>
      <span className="sr-only">Loading medication</span>
    </div>
  );
}
