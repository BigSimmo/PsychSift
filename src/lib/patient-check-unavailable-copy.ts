/**
 * What Ask says when the patient-detail check cannot load. With no connection the old wording
 * ("Could not check your question for patient details") read as if the question had broken a
 * rule, so offline gets its own plain message (design audit D26-11). Either way nothing is sent.
 */
export const PATIENT_CHECK_UNAVAILABLE_MESSAGE =
  "Could not check your question for patient details. Check your connection and try again.";

export const PATIENT_CHECK_OFFLINE_MESSAGE =
  "You're offline, so nothing was sent. Your question is kept here. Try again when you have signal.";

export function patientCheckUnavailableMessage(online = typeof navigator === "undefined" || navigator.onLine) {
  return online ? PATIENT_CHECK_UNAVAILABLE_MESSAGE : PATIENT_CHECK_OFFLINE_MESSAGE;
}
