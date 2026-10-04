import { BrainCircuit } from "lucide-react";

import type { FavouriteItem } from "@/components/clinical-dashboard/favourites-prototype-data";
import { UNSORTED_SET_NAME } from "@/components/favourites/favourites-view-model";
import { appModeIcons } from "@/lib/app-mode-icons";
import { getDifferentialRecord } from "@/lib/differentials";
import { findTherapyRecord } from "@/lib/therapies";

/**
 * The signed-out sample of Favourites: a handful of real catalogue entries
 * (differential diagnoses and therapy records that ship with the app, each
 * opening its own working page) shown as if saved, with one sample set.
 *
 * Loaded on demand, only for a signed-out visitor. Titles and descriptions come
 * from the catalogue itself; nothing is invented, read from the server or stored.
 */

export const FAVOURITES_SAMPLE_SET = "Teaching prep";

/** Existing differential diagnosis slugs (`/differentials/diagnoses/<slug>`). */
export const SAMPLE_DIFFERENTIAL_SLUGS = [
  "major-depressive-disorder",
  "bipolar-disorder",
  "generalised-anxiety-disorder",
  "schizophrenia",
] as const;

/** Existing, reviewed therapy slugs (`/therapy-compass/<slug>`). */
export const SAMPLE_THERAPY_SLUGS = [
  "acceptance-and-commitment-therapy-act",
  "cognitive-therapy-for-ptsd-ct-ptsd",
  "cognitive-behavioural-therapy-for-insomnia",
] as const;

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
  const differentials = SAMPLE_DIFFERENTIAL_SLUGS.flatMap((slug) => {
    const record = getDifferentialRecord(slug);
    if (!record) return [];
    return [
      {
        id: `differentials:${slug}`,
        title: record.title,
        type: "differentials",
        set: SET_MEMBERS.has(`differentials:${slug}`) ? FAVOURITES_SAMPLE_SET : UNSORTED_SET_NAME,
        meta: "Saved diagnosis",
        sourceMeta: "Differential",
        primaryAction: "Open",
        href: `/differentials/diagnoses/${encodeURIComponent(slug)}`,
        icon: BrainCircuit,
        keywords: `${record.title} ${slug.replaceAll("-", " ")}`.toLowerCase(),
      } satisfies FavouriteItem,
    ];
  });
  const therapies = SAMPLE_THERAPY_SLUGS.flatMap((slug) => {
    const therapy = findTherapyRecord(slug);
    if (!therapy) return [];
    return [
      {
        id: `therapies:${slug}`,
        title: therapy.name,
        type: "therapies",
        set: SET_MEMBERS.has(`therapies:${slug}`) ? FAVOURITES_SAMPLE_SET : UNSORTED_SET_NAME,
        meta: therapy.bestUsedFor ?? therapy.category ?? "Saved therapy record",
        sourceMeta: therapy.reviewStatus === "reviewed" ? "Reviewed therapy" : "Source review required",
        primaryAction: "Open",
        href: `/therapy-compass/${slug}`,
        icon: appModeIcons["therapy-compass"],
        keywords: [therapy.name, therapy.category, ...therapy.tags].filter(Boolean).join(" ").toLowerCase(),
      } satisfies FavouriteItem,
    ];
  });
  return { items: [...differentials, ...therapies], pinnedIds: PINNED };
}
