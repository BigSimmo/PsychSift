import { BrainCircuit } from "lucide-react";

import type { FavouriteItem } from "@/components/clinical-dashboard/favourites-prototype-data";
import { UNSORTED_SET_NAME } from "@/components/favourites/favourites-view-model";
import { appModeIcons } from "@/lib/app-mode-icons";

/**
 * The signed-out sample of Favourites: a handful of real catalogue entries
 * (differential diagnoses and therapy records that ship with the app, each
 * opening its own working page) shown as if saved, with one sample set.
 *
 * Loaded on demand, only for a signed-out visitor. The titles are the
 * catalogue's own, held here as plain text so this chunk does not download the
 * whole differentials and therapy catalogues (a test holds them to the
 * catalogue). Nothing is invented, read from the server or stored.
 */

export const FAVOURITES_SAMPLE_SET = "Teaching prep";

/** Existing differential diagnosis slugs (`/differentials/diagnoses/<slug>`). */
export const SAMPLE_DIFFERENTIALS = {
  "major-depressive-disorder": "Major depressive disorder",
  "bipolar-disorder": "Bipolar disorder",
  "generalised-anxiety-disorder": "Generalised anxiety disorder",
  schizophrenia: "Schizophrenia",
} as const;
export const SAMPLE_DIFFERENTIAL_SLUGS = Object.keys(SAMPLE_DIFFERENTIALS) as (keyof typeof SAMPLE_DIFFERENTIALS)[];

/** Existing, reviewed therapy slugs (`/therapy-compass/<slug>`). */
export const SAMPLE_THERAPIES = {
  "acceptance-and-commitment-therapy-act": "Acceptance and Commitment Therapy (ACT)",
  "cognitive-therapy-for-ptsd-ct-ptsd": "Cognitive Therapy for PTSD (CT-PTSD)",
  "cognitive-behavioural-therapy-for-insomnia": "Cognitive behavioural therapy for insomnia",
} as const;
export const SAMPLE_THERAPY_SLUGS = Object.keys(SAMPLE_THERAPIES) as (keyof typeof SAMPLE_THERAPIES)[];

/** Shown in the sample set; the rest are unsorted. */
const SET_MEMBERS = new Set<string>([
  "differentials:major-depressive-disorder",
  "differentials:bipolar-disorder",
  "therapies:acceptance-and-commitment-therapy-act",
]);

/** Pinned at first, so Quick launch is filled; pinning in the sample lives in the page's memory only. */
const PINNED = ["differentials:major-depressive-disorder", "therapies:acceptance-and-commitment-therapy-act"];

export interface FavouritesSample {
  readonly items: readonly FavouriteItem[];
  readonly pinnedIds: readonly string[];
}

export function buildFavouritesSample(): FavouritesSample {
  const differentials = SAMPLE_DIFFERENTIAL_SLUGS.map((slug) => {
    const title = SAMPLE_DIFFERENTIALS[slug];
    return {
      id: `differentials:${slug}`,
      title,
      type: "differentials",
      set: SET_MEMBERS.has(`differentials:${slug}`) ? FAVOURITES_SAMPLE_SET : UNSORTED_SET_NAME,
      meta: "Saved diagnosis",
      sourceMeta: "Differential",
      primaryAction: "Open",
      href: `/differentials/diagnoses/${encodeURIComponent(slug)}`,
      icon: BrainCircuit,
      keywords: title.toLowerCase(),
    } satisfies FavouriteItem;
  });
  const therapies = SAMPLE_THERAPY_SLUGS.map((slug) => {
    const title = SAMPLE_THERAPIES[slug];
    return {
      id: `therapies:${slug}`,
      title,
      type: "therapies",
      set: SET_MEMBERS.has(`therapies:${slug}`) ? FAVOURITES_SAMPLE_SET : UNSORTED_SET_NAME,
      meta: "Saved therapy",
      sourceMeta: "Reviewed therapy",
      primaryAction: "Open",
      href: `/therapy-compass/${slug}`,
      icon: appModeIcons["therapy-compass"],
      keywords: title.toLowerCase(),
    } satisfies FavouriteItem;
  });
  return { items: [...differentials, ...therapies], pinnedIds: PINNED };
}
