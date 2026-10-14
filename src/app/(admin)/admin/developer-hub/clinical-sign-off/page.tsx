import type { Metadata } from "next";

import { SignOffQueuePageContent } from "@/components/developer-area/hub/sign-off-queue-page-content";

export const metadata: Metadata = {
  title: "Clinical sign-off queue · Developer · PsychSift",
  description: "The clinical records this repository holds on disk that are waiting for a person to sign them off.",
};

type DeveloperClinicalSignOffPageProps = {
  searchParams?: Promise<{ family?: string | string[]; page?: string | string[] }>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePageParam(value: string | string[] | undefined): number {
  const raw = firstValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Thin async wrapper only — Next 16 serves `searchParams` as a `Promise`, so
 * unwrapping it is the one thing here that has to be async. The queue read, the
 * family and page slices and the markup all stay in the synchronous
 * `SignOffQueuePageContent`, which a dom test can render directly. Mirrors
 * `DeveloperReviewStatePage`, the sibling page this pagination is copied from.
 */
export default async function DeveloperClinicalSignOffPage({ searchParams }: DeveloperClinicalSignOffPageProps) {
  const params = searchParams ? await searchParams : {};
  const family = firstValue(params.family);
  return (
    <SignOffQueuePageContent
      {...(family === undefined ? {} : { requestedFamily: family })}
      requestedPage={parsePageParam(params.page)}
    />
  );
}
