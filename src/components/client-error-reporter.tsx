"use client";

import { useEffect } from "react";
import { installClientErrorReporter } from "@/lib/observability/client-error-report";

const ENABLED = process.env.NODE_ENV === "production";

/**
 * Sends a code-location-only report of uncaught browser errors to our own server, which forwards
 * it through the server's Sentry scrubber (see `@/lib/observability/client-error-report`).
 * Production only, and rendered eagerly in the root layout so it is listening before lazy code runs.
 */
export function ClientErrorReporter() {
  useEffect(() => (ENABLED ? installClientErrorReporter() : undefined), []);
  return null;
}
