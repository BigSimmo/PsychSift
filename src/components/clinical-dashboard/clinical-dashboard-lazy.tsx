"use client";

import dynamic from "next/dynamic";

import { AnswerSkeleton } from "@/components/clinical-dashboard/answer-skeleton";
import { LoadingPanel } from "@/components/ui-primitives";

// Every surface here is `ssr: false`, so the server sends no markup for it and
// the slot stays EMPTY until the chunk downloads and executes. Without a
// `loading` fallback that reads to the user (and to a screen reader) as nothing
// happening. LoadingPanel carries role="status" + an accessible label, so each
// slot announces itself while its chunk is in flight.

export const DifferentialsHome = dynamic(
  () => import("@/components/clinical-dashboard/differentials-home").then((m) => m.DifferentialsHome),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={6} label="Loading differentials" /> },
);
export const FavouritesHub = dynamic(
  () => import("@/components/clinical-dashboard/favourites-hub").then((m) => m.FavouritesHub),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={5} label="Loading favourites" /> },
);
export const MedicationPrescribingWorkspace = dynamic(
  () =>
    import("@/components/clinical-dashboard/medication-prescribing-workspace").then(
      (m) => m.MedicationPrescribingWorkspace,
    ),
  {
    ssr: false,
    loading: () => <LoadingPanel variant="skeleton" lines={6} label="Loading prescribing workspace" />,
  },
);
export const DocumentDrawer = dynamic(
  () => import("@/components/clinical-dashboard/document-admin").then((m) => m.DocumentDrawer),
  // The drawer mounts on open, so a spinner reads better than a content skeleton.
  { ssr: false, loading: () => <LoadingPanel label="Loading document tools" /> },
);

// Results surfaces load lazily. Preload the primary answer surface after hydration so a cold
// browser does not finish a fast/cached answer before the result UI chunk is available.
export const loadStagedAnswerResultSurface = () =>
  import("@/components/clinical-dashboard/answer-result-surface").then((m) => m.StagedAnswerResultSurface);
export const StagedAnswerResultSurface = dynamic(loadStagedAnswerResultSurface, {
  ssr: false,
  loading: () => <AnswerSkeleton />,
});
export const RelatedDocumentsPanel = dynamic(
  () => import("@/components/clinical-dashboard/document-results").then((m) => m.RelatedDocumentsPanel),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={3} label="Loading related documents" /> },
);
export const DocumentSearchResultsPanel = dynamic(
  () => import("@/components/clinical-dashboard/document-search-results").then((m) => m.DocumentSearchResultsPanel),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={5} label="Loading document results" /> },
);

// Admin/setup tools are rare paths — keep them out of the initial dashboard chunk.
// All three resolve to the same DocumentManagerPanel module, so whichever mounts
// first pays for the whole chunk; the fallback covers that wait.
export const SetupChecklist = dynamic(
  () => import("@/components/clinical-dashboard/DocumentManagerPanel").then((m) => m.SetupChecklist),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={4} label="Loading setup checklist" /> },
);
export const IndexingMonitor = dynamic(
  () => import("@/components/clinical-dashboard/DocumentManagerPanel").then((m) => m.IndexingMonitor),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={4} label="Loading indexing monitor" /> },
);
export const IngestionQualityConsole = dynamic(
  () => import("@/components/clinical-dashboard/DocumentManagerPanel").then((m) => m.IngestionQualityConsole),
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={4} label="Loading ingestion quality" /> },
);

export const ClinicalAskWorkspace = dynamic(
  () => import("@/components/clinical-dashboard/clinical-ask-workspace").then((m) => m.ClinicalAskWorkspace),
  // Empty-home idle render is null. A skeleton here shifts SharedHomeEmptyState
  // (Lighthouse CLS on `/`) and pushes the in-flow composer into the PWA sheet.
  { ssr: false, loading: () => null },
);
