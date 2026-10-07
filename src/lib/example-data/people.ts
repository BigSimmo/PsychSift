/**
 * The standard example people and places. Every example dataset takes its names
 * from here so they are obviously made up, consistent across screens, and never
 * a real WA clinician, hospital, ward or phone number (owner rule, 7 Oct 2026).
 * Surnames are Western Australian plants, which no reader mistakes for a colleague.
 * Nurses and admin staff take the same surnames without the "Dr". Where a sample
 * names someone by title and surname only (a referee, a handover note), it uses
 * one of these surnames.
 */

export const EXAMPLE_PEOPLE = [
  "Dr Alex Jarrah",
  "Dr Sam Karri",
  "Dr Jo Banksia",
  "Dr Robin Wattle",
  "Dr Casey Marri",
  "Dr Jordan Tuart",
  "Dr Riley Boronia",
  "Dr Morgan Grevillea",
  "Dr Quinn Wandoo",
  "Dr Taylor Kwongan",
  "Dr Kim Yate",
  "Dr Lee Mallee",
  "Dr Pat Tingle",
  "Dr Ash Zamia",
  "Dr Drew Hakea",
  "Dr Charlie Balga",
  "Dr Frankie Mulga",
  "Dr Lou Quandong",
  "Dr Rowan Sheoak",
] as const;

/** The reader's own example persona, used where a screen shows "you". */
export const EXAMPLE_SELF = "Dr Avery Example";

export const EXAMPLE_HOSPITAL = "Example Hospital";
export const EXAMPLE_HOSPITALS = ["Example Hospital", "Example Health Campus", "Example Mental Health Unit"] as const;
export const EXAMPLE_WARDS = ["Ward A", "Ward B", "Ward C"] as const;
/** Phone numbers are extensions of zeros, never a dialable number. */
export const EXAMPLE_EXTENSIONS = ["Ext 0000", "Ext 0001", "Ext 0002"] as const;
