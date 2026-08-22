// src/lib/caring-contacts/episode.ts
//
// The one episode shape in this domain.
//
// These types were introduced in Task 8 inside the de-identification policy module, because no
// episode concept existed yet. Task 9's store needs the same shape to project an episode from what
// it holds, and the Task 8 sibling guard requires that no other module in this directory name that
// policy module at all — so importing the types from it was not open to the store. They live here
// instead: one declaration, imported by both, re-exported unchanged by the policy module so every
// existing import path still resolves. This is a relocation, not a second shape; there is no
// competing episode type anywhere in this directory.
import type { PathwayVersionId, TeamId } from "./ids";

export type EpisodeState = "draft" | "active" | "paused" | "withdrawn" | "cancelled" | "completed";

export type EpisodeCounts = {
  contactsScheduled: number;
  contactsSent: number;
  contactsDelivered: number;
};

export type EpisodePlanDates = {
  dischargeAt: Date;
  /** The instant the episode reached its terminal state; null while it is still open. */
  completedAt: Date | null;
};

export type Episode = {
  state: EpisodeState;
  patientName: string;
  patientMobileNumber: string;
  patientIdentifiers: readonly string[];
  culturalIdentity: string | null;
  planDates: EpisodePlanDates;
  pathwayVersionId: PathwayVersionId;
  teamId: TeamId;
  outcome: string;
  counts: EpisodeCounts;
};

export type DeidentifiedEpisode = {
  state: EpisodeState;
  planDates: EpisodePlanDates;
  pathwayVersionId: PathwayVersionId;
  teamId: TeamId;
  outcome: string;
  counts: EpisodeCounts;
};
