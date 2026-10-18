export const answerFeedbackTypes = [
  "verified",
  "needs_correction",
  "source_insufficient",
  "wrong_source",
  "missing_source",
  "unsupported_answer",
  "numeric_error",
  "outdated_guidance",
  "wrong_mode",
  "missed_source",
  "unsupported_conclusion",
  "important_information_missing",
  "source_conflict",
  "outdated_source",
  "presentation_problem",
] as const;

export type AnswerFeedbackType = (typeof answerFeedbackTypes)[number];

/** The optional note a reader can add to a report. Kept short: it says where the fault is, not the case. */
export const ANSWER_FEEDBACK_NOTE_MAX_LENGTH = 500;

/** Which page a report came from: an answer, or a medication or therapy record. */
export const feedbackRecordTypes = ["answer", "medication", "therapy"] as const;
export type FeedbackRecordType = (typeof feedbackRecordTypes)[number];

/** A record's public slug, the same shape the database check accepts. */
export const feedbackRecordIdPattern = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** What a report control hands its host: the category, and the trimmed note when one was typed. */
export type SubmitAnswerFeedback = (feedbackType: AnswerFeedbackType, note?: string) => void;
