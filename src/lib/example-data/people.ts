/**
 * The standard example people and places. Every example dataset takes its names
 * from here so they are obviously made up, consistent across screens, and never
 * a real WA clinician, hospital, ward or phone number (owner rule, 7 Oct 2026).
 * Surnames are Western Australian plants, which no reader mistakes for a colleague.
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
] as const;

/** The reader's own example persona, used where a screen shows "you". */
export const EXAMPLE_SELF = "Dr Avery Example";

export const EXAMPLE_HOSPITAL = "Example Hospital";
export const EXAMPLE_HOSPITALS = ["Example Hospital", "Example Health Campus", "Example Mental Health Unit"] as const;
export const EXAMPLE_WARDS = ["Ward A", "Ward B", "Ward C"] as const;
/** Phone numbers are extensions of zeros, never a dialable number. */
export const EXAMPLE_EXTENSIONS = ["Ext 0000", "Ext 0001", "Ext 0002"] as const;
