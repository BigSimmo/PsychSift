"use client";

import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorBoundary error={error} reset={reset} />;
}
