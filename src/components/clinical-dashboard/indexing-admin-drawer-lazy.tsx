"use client";

import dynamic from "next/dynamic";

// Admin-only and closed by default: kept off `/`'s hydration path, warmed on idle by the
// dashboard. Lives apart from clinical-dashboard-lazy.tsx, which the drawer itself imports.
export const loadIndexingAdminDrawer = () =>
  import("@/components/clinical-dashboard/indexing-admin-drawer").then((m) => m.IndexingAdminDrawer);
export const IndexingAdminDrawer = dynamic(loadIndexingAdminDrawer, { ssr: false });
