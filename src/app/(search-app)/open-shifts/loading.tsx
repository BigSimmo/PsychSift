import { Skeleton } from "@/components/ui-primitives";

/**
 * Open shifts pages are a narrow reading column under the mode band: a title,
 * then a flat list. The loading state uses the same column, title spacing and
 * row height, so nothing moves or changes width when the page arrives.
 */
function OpenShiftsLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-reading" data-testid="open-shifts-route-loading">
      <div role="status" aria-label="Loading" className="grid min-w-0">
        <div className="px-3 pt-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-56 max-w-full" />
        </div>
        <div className="flex flex-col gap-3 px-3 py-4">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-14 rounded-md" />
          ))}
        </div>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}

export default function Loading() {
  return <OpenShiftsLoadingSkeleton />;
}
