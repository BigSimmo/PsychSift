// Reserved fictional numbers only. These are ACMA/Ofcom-style numbers that can never
// connect to a real person, so a screenshot, a test failure or a demonstration can show a
// complete message without any possibility of contacting anyone.
export const FICTIONAL_CONTACTS_BY_ROLE = Object.freeze({
  miraPatientMobile: "+61 491 570 006",
  rowanPatientMobile: "+61 491 570 156",
  programmeStaffedLine: "+61 491 570 157",
  crisisSupportContact: "+61 491 570 158",
} as const);

export type FictionalContactRole = keyof typeof FICTIONAL_CONTACTS_BY_ROLE;

export const DESIGNATED_FICTIONAL_MOBILE_NUMBERS = Object.freeze([
  FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine,
  FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact,
] as const);

export type DesignatedFictionalMobileNumber = (typeof DESIGNATED_FICTIONAL_MOBILE_NUMBERS)[number];
export type SyntheticPatientMobile =
  (typeof FICTIONAL_CONTACTS_BY_ROLE)["miraPatientMobile"] | (typeof FICTIONAL_CONTACTS_BY_ROLE)["rowanPatientMobile"];
