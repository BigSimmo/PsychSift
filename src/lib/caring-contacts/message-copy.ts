import { calculateGsm7, type Gsm7Evidence } from "./message-policy";
import { FICTIONAL_CONTACTS_BY_ROLE } from "./synthetic-contacts";

// PROVISIONAL — not clinically approved. Corrected 2026-08-19 under production-build spec §2.1, which
// replaced the non-receiving sender with a receiving-capable number that auto-responds and discards.
// The previous wording ("Replies are not received, stored, analysed or monitored") became untrue the
// moment the number could receive: replies ARE received, then discarded unread. Stating something false
// about a safety boundary is the failure this programme can least afford, so the claim now describes only
// what remains true — that nobody reads them. Final wording is a clinical decision owned by the
// lived-experience and clinical-programme approval gate (docs/caring-contacts/message-review-pack.md §1).
export const PATIENT_VISIBLE_NO_REPLY_NOTICE = "No one reads replies to this number";

export const EXACT_PATIENT_VISIBLE_MESSAGE = `Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message. ${PATIENT_VISIBLE_NO_REPLY_NOTICE}. For timing changes call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}. - Alex`;

// PROVISIONAL — not clinically approved. Required by production-build spec §2.1: the automated response
// sent to anyone who replies. It must name where a person IS available, immediately after saying that
// nobody reads this channel, so that reaching out is answered rather than met with silence. Content is
// discarded after this response is sent; nothing is stored, counted per patient, or shown to staff.
export const AUTOMATED_REPLY_RESPONSE = `This number is not read. Your message has not been seen by anyone and has not been kept. To talk to someone, call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.`;

export const EXACT_MESSAGE_GSM7: Gsm7Evidence = calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE);
export const AUTOMATED_REPLY_GSM7: Gsm7Evidence = calculateGsm7(AUTOMATED_REPLY_RESPONSE);
