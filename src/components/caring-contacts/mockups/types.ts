import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
  type DesignatedFictionalMobileNumber,
  type FictionalContactRole,
  type SyntheticPatientMobile,
} from "@/lib/caring-contacts/synthetic-contacts";

export type PrimaryDestination = "Today" | "Patients" | "Schedule" | "Templates";
export type MoreDestination = "Team" | "Guidance" | "Reports";
export type WorkspaceDestination = PrimaryDestination | MoreDestination;

export const APPROVED_CARING_CONTACT_ROUTE_IDENTITIES = {
  today: "/caring-contacts",
  patients: "/caring-contacts/patients",
  patient: "/patients/[patientId]",
  newPlan: "/plans/new",
  plan: "/plans/[planId]",
  schedule: "/caring-contacts/schedule",
  contact: "/contacts/[contactId]",
  templates: "/caring-contacts/templates",
  pathwayTemplate: "/templates/[pathwayId]",
  team: "/caring-contacts/team",
  guidance: "/caring-contacts/guidance",
  reports: "/caring-contacts/reports",
} as const;

export const SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS = [
  "/caring-contacts/patients/[episodeId]/activate/*",
  "/caring-contacts/patients/[episodeId]/plan",
  "/caring-contacts/patients/[episodeId]/contacts/[contactId]",
  "/caring-contacts/patients/[episodeId]",
  "/caring-contacts/templates/[versionId]",
] as const;

export {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
  type DesignatedFictionalMobileNumber,
  type FictionalContactRole,
  type SyntheticPatientMobile,
};

export type ContactWindow = "Morning" | "Afternoon" | "Early evening";
export type SyntheticSendingPreference = {
  window: ContactWindow;
  scheduledTime: string;
  windowLabel: string;
};
export type TransportState =
  | "Scheduled"
  | "Processing"
  | "Sent"
  | "Delivered"
  | "Not delivered"
  | "Number invalid"
  | "Contact changed"
  | "Status unavailable"
  | "Missed";

export type SyntheticPatient = {
  id: string;
  fullName: string;
  preferredName: string;
  dateOfBirth: string;
  mobile: SyntheticPatientMobile;
  mobileSource: string;
  patientControlledForSms: boolean;
};

export type SyntheticReferral = {
  id: string;
  patientId: string;
  referringTeam: string;
  receivedAt: string;
  dischargedAt: string;
  handoverState: "Awaiting handover" | "Accepted" | "Clarification requested";
  agreementConfirmed: boolean;
};

export type SyntheticEpisode = {
  id: string;
  patientId: string;
  referralId: string;
  state: "Awaiting activation" | "Active" | "Paused" | "Completed" | "Withdrawn" | "Cancelled";
  coordinatorId: string;
  pathwayId: string;
  openedAt: string;
  selectedSendingPreference: SyntheticSendingPreference;
};

export type GovernanceApprovalState = "Illustrative — approval pending" | "Locally approved";
export type GovernanceLifecycle = "Current" | "Retired";
export type SyntheticTwoPersonApprovalEvidence = {
  clinicalProgrammeLead: string;
  livedExperienceContentReviewer: string;
};

export type SyntheticPathway = {
  id: string;
  name: string;
  version: string;
  duration: string;
  cadence: readonly string[];
  senderLabel: string;
  governanceLabel: "Illustrative locally governed pathway";
  approvalState: GovernanceApprovalState;
  lifecycle: GovernanceLifecycle;
  approvalEvidence: SyntheticTwoPersonApprovalEvidence | null;
};

export type SyntheticPlannedContact = {
  id: string;
  episodeId: string;
  sequence: number;
  cadenceLabel: string;
  scheduledAt: string;
  window: ContactWindow;
  windowLabel: string;
  transportState: TransportState;
};

export type SyntheticTemplate = {
  id: string;
  name: string;
  version: string;
  variant: string;
  segmentCount: 1 | 2;
  encoding: "GSM-7" | "Unicode";
  approvalState: GovernanceApprovalState;
  lifecycle: GovernanceLifecycle;
  approvalEvidence: SyntheticTwoPersonApprovalEvidence | null;
};

export type SyntheticDeliveryEvent = {
  id: string;
  contactId: string;
  occurredAt: string;
  state: TransportState;
  operationalNote: string;
};

export type SyntheticTeamMember = {
  id: string;
  displayName: string;
  role: "Coordinator" | "Team lead" | "Authorised clinician";
};

export type SyntheticAuditEvent = {
  id: string;
  occurredAt: string;
  actorId: string;
  action: string;
  objectId: string;
};
