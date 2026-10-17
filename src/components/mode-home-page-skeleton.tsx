import { Skeleton } from "@/components/ui-primitives";

export function ModeHomePageSkeleton() {
  return (
    <div
      className="mx-auto grid w-full max-w-[60rem] justify-items-center gap-4 px-4 py-8 sm:gap-6 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label="Loading"
    >
      {/* Mirrors ModeHomeHero: same medallion token, same copy gap, so the
          skeleton does not resize the hero when the real content mounts. */}
      <Skeleton className="size-hero-medallion rounded-2xl" />
      <div className="grid w-full justify-items-center gap-1 sm:gap-1.5">
        <Skeleton className="h-7 w-2/3 max-w-sm sm:h-9 lg:h-10" />
        <Skeleton className="h-5 w-1/2 max-w-xs" />
      </div>
      <Skeleton className="mt-2 h-14 w-full max-w-xl rounded-full" />
      <div className="mt-4 grid w-full max-w-xl gap-3">
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="50ms" />
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="100ms" />
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="150ms" />
      </div>
      <span className="text-sm text-[color:var(--text-muted)]">Loading…</span>
    </div>
  );
}

export function ModeHomeRouteLoading() {
  return (
    // Match ModeHomeMain startOnPhone: top-align on phones, centre from sm up.
    // A phone-centred skeleton jumped when content-rich homes mounted top-aligned.
    <div className="grid min-h-0 w-full flex-1 items-start justify-items-center bg-[color:var(--background)] pt-3 sm:items-center sm:pt-0">
      <ModeHomePageSkeleton />
    </div>
  );
}

export function DocumentSearchPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[104rem] space-y-4 px-3 py-4 sm:px-5 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label="Loading documents"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-full max-w-2xl rounded-xl" />
      <div className="grid gap-3">
        <Skeleton className="h-20 w-full rounded-lg" animationDelay="50ms" />
        <Skeleton className="h-20 w-full rounded-lg" animationDelay="100ms" />
        <Skeleton className="h-20 w-full rounded-lg" animationDelay="150ms" />
      </div>
      <span className="sr-only">Loading documents</span>
    </div>
  );
}

export function DocumentViewerPageSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label="Loading document"
    >
      <Skeleton className="h-10 w-full max-w-lg" />
      <Skeleton className="min-h-0 flex-1 rounded-lg" />
      <span className="sr-only">Loading document</span>
    </div>
  );
}

export function OnCallPageSkeleton() {
  return (
    <main
      className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label="Loading On Call shift information"
    >
      {/* Search box placeholder */}
      <Skeleton className="h-12 w-full rounded-lg" />
      {/* Next shift placeholder */}
      <Skeleton className="h-20 w-full rounded-lg" animationDelay="50ms" />
      {/* Tool tiles */}
      <div className="grid gap-2">
        <Skeleton className="h-14 w-full rounded-lg" animationDelay="75ms" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-16 w-full rounded-lg" animationDelay="100ms" />
          <Skeleton className="h-16 w-full rounded-lg" animationDelay="125ms" />
          <Skeleton className="h-16 w-full rounded-lg" animationDelay="150ms" />
        </div>
      </div>
      {/* Call first section */}
      <div className="space-y-2 pt-2">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-20 w-full rounded-lg" animationDelay="175ms" />
          <Skeleton className="h-20 w-full rounded-lg" animationDelay="200ms" />
        </div>
      </div>
      {/* Wards row */}
      <div className="space-y-2 pt-2">
        <Skeleton className="h-4 w-28" />
        <div className="flex gap-2 overflow-hidden">
          <Skeleton className="h-8 w-24 rounded-full shrink-0" animationDelay="225ms" />
          <Skeleton className="h-8 w-28 rounded-full shrink-0" animationDelay="250ms" />
          <Skeleton className="h-8 w-20 rounded-full shrink-0" animationDelay="275ms" />
          <Skeleton className="h-8 w-24 rounded-full shrink-0" animationDelay="300ms" />
        </div>
      </div>
      {/* Tile grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 pt-2">
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="325ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="350ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="375ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="400ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="425ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="450ms" />
      </div>
      <span className="sr-only">Loading On Call shift information</span>
    </main>
  );
}

export function CmeDashboardSkeleton() {
  return (
    <main
      className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label="Loading CME and CPD dashboard"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      {/* Annual summary block */}
      <Skeleton className="h-36 w-full rounded-xl" animationDelay="50ms" />
      {/* Requirement categories */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-lg" animationDelay="100ms" />
        <Skeleton className="h-28 w-full rounded-lg" animationDelay="150ms" />
        <Skeleton className="h-28 w-full rounded-lg" animationDelay="200ms" />
        <Skeleton className="h-28 w-full rounded-lg" animationDelay="250ms" />
      </div>
      {/* Recent activities section */}
      <div className="space-y-3 pt-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="300ms" />
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="350ms" />
        <Skeleton className="h-16 w-full rounded-lg" animationDelay="400ms" />
      </div>
      <span className="sr-only">Loading CME and CPD dashboard</span>
    </main>
  );
}

export function CatalogueSearchPageSkeleton({ label = "Loading results" }: { label?: string }) {
  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6 animate-fade-in motion-reduce:animate-none"
      role="status"
      aria-label={label}
    >
      {/* Filter / search query bar */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg shrink-0" />
      </div>
      {/* Results count and active filter summary */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      {/* Card list */}
      <div className="space-y-3 pt-1">
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="50ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="100ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="150ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="200ms" />
        <Skeleton className="h-24 w-full rounded-lg" animationDelay="250ms" />
      </div>
      <span className="sr-only">{label}</span>
    </main>
  );
}
