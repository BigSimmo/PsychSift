/**
 * The frozen 24-overlay contract for the production caring-contacts workspace.
 *
 * This is a fresh transcription of `docs/caring-contacts/interaction-matrix.md`,
 * which is the frozen record. It is deliberately NOT an import from the
 * design-scratch specimen tree — production may never import from it, and
 * `tests/caring-contact-route-files.test.ts` fails on the mere mention of that
 * path here. A hand copy that drifts is worse than no copy at all, so
 * `tests/caring-contacts-overlay-definitions.test.ts` parses the matrix document
 * itself and checks this table against it row for row.
 *
 * Task 18 builds one renderer against these values and Task 19 proves all 24 in
 * a browser at two widths. Change a modality here and you have changed what both
 * of those prove; change it in the matrix document without changing it here and
 * the test goes red naming the row.
 *
 * Every `summary` and `decision` is patient-adjacent interface copy: plain
 * Australian English, sentence case, no clinical inference, and no claim that
 * anybody is reading replies.
 */

export type OverlayPhoneModality = "bottom-sheet" | "full-screen-stage" | "session-gate" | "status-banner";
export type OverlayDesktopModality = "dialog" | "inspection-drawer" | "session-gate" | "status-banner";
/**
 * `action-only` is RESERVED and currently unused. The matrix document expresses
 * only two dismissal values across its 24 rows — `Escape, backdrop, close` and
 * `Recovery action only` — and the latter reads the same for `session-expiry`
 * and `offline-banner`, so neither row can be distinguished into `action-only`
 * without inventing a distinction the frozen record does not make (Ruling 58).
 *
 * It was kept rather than deleted because this union is a pinned interface that
 * Tasks 18 and 19 build against. It is NOT forgotten: the "uses only the
 * dismissal values the matrix expresses" test in
 * `tests/caring-contacts-overlay-definitions.test.ts` fails the moment a row
 * takes this value, which forces the change to be justified against the matrix
 * — where the authority lives — rather than assigned quietly here.
 */
export type OverlayDismissal = "escape-backdrop-close" | "action-only" | "recovery-only";
export type OverlayAvailability = "Available" | "Read only" | "Unavailable until resolved";

/**
 * Every field is `readonly` because this table is a frozen contract, not state.
 * `Object.freeze` below stops a row being replaced but is shallow — it would not
 * stop `WORKSPACE_OVERLAY_DEFINITIONS[0].label = "..."` in a renderer. The
 * `readonly` markers close that at type level, so a consumer that tries to edit
 * a row fails to compile rather than quietly disagreeing with the frozen record
 * at runtime.
 */
export type WorkspaceOverlayDefinition = {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly decision: string;
  readonly availability: OverlayAvailability;
  readonly mutatesState: boolean;
  readonly requiresFreshAuthentication: boolean;
  readonly phoneModality: OverlayPhoneModality;
  readonly desktopModality: OverlayDesktopModality;
  readonly dismissal: OverlayDismissal;
  readonly tone?: "primary" | "danger";
};

/**
 * The 24 overlays in matrix order. The order is part of the contract: the
 * row-for-row test walks the document and this array together.
 */
export const WORKSPACE_OVERLAY_DEFINITIONS: readonly WorkspaceOverlayDefinition[] = Object.freeze([
  {
    id: "verify-identity",
    label: "Verify identity",
    title: "Check the identity before changing patient",
    summary: "Compare the person selected here with the invented source record before going any further.",
    decision: "Confirm identity",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "change-patient",
    label: "Change patient",
    title: "Change the selected patient",
    summary: "Choosing a different patient clears the current draft and everything picked for this one.",
    decision: "Change patient",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "pathway-preview",
    label: "Pathway preview",
    title: "Preview the approved pathway",
    summary: "Read the approved pathway in full before choosing it. Nothing here is ranked or recommended for you.",
    decision: "Use this pathway",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "message-preview",
    label: "Message preview",
    title: "Preview the message the patient would see",
    summary: "The wording is shown exactly as it would arrive, with every detail already filled in.",
    decision: "Back to personalisation",
    availability: "Read only",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "communication-preference",
    label: "Communication preference",
    title: "Record a communication preference",
    summary: "Record only a preference the patient gave through the staffed programme phone.",
    decision: "Record preference",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "adjust-date-time",
    label: "Adjust date and time",
    title: "Adjust the time of one contact",
    summary: "A contact can be moved only within the day it is already scheduled for.",
    decision: "Save the new time",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "outside-window-warning",
    label: "Outside-window warning",
    title: "Outside the approved sending window",
    summary: "The time asked for falls outside 9:00 am to 6:00 pm AWST, so it cannot be scheduled.",
    decision: "Keep the approved time",
    availability: "Unavailable until resolved",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "save-draft",
    label: "Save draft",
    title: "Save this activation draft",
    summary: "The draft is kept as it stands. Nothing is sent and no plan starts.",
    decision: "Save draft",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "discard-changes",
    label: "Discard changes",
    title: "Discard unsaved changes",
    summary: "Only the edits made in this session go. The approved versions and the history stay as they are.",
    decision: "Discard changes",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "final-activation",
    label: "Final activation",
    title: "Last check before the plan starts",
    summary:
      "Everything is checked once more: the person, the agreement, who owns the plan, the approved versions, the wording and every send time.",
    decision: "Confirm and activate",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "activation-success",
    label: "Activation success",
    title: "Plan activation recorded",
    summary: "The plan is recorded. This confirmation carries no patient detail.",
    decision: "View the plan",
    availability: "Read only",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "pause",
    label: "Pause",
    title: "Pause this plan",
    summary:
      "Pausing can be undone, but the original dates never shift. Contacts that fall inside the pause are skipped for good.",
    decision: "Pause future contacts",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "withdrawal",
    label: "Withdrawal",
    title: "Record a withdrawal the patient asked for",
    summary: "Every contact not yet sent is cancelled straight away. This needs no approval and cannot be undone.",
    decision: "Continue and confirm who you are",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "reassignment",
    label: "Reassignment",
    title: "Reassign the coordinator",
    summary: "Coordination moves to someone else and the whole handover stays on the record.",
    decision: "Continue and confirm who you are",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "delivery-detail",
    label: "Delivery detail",
    title: "What the phone network reported",
    summary:
      "This shows how the message travelled and nothing else. It does not show that it was read or that it helped.",
    decision: "Close this detail",
    availability: "Read only",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "resolve-failed-delivery",
    label: "Resolve failed delivery",
    title: "Close off a delivery that failed",
    summary:
      "All three attempts in the original window are finished and there is no later retry. Record what was done instead.",
    decision: "Record what was done",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "contact-changed-block",
    label: "Contact-changed block",
    title: "The contact number has changed",
    summary: "A changed mobile number pauses future contacts until a coordinator has checked where it came from.",
    decision: "Keep the plan paused",
    availability: "Unavailable until resolved",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "template-changed-retired",
    label: "Template changed or retired",
    title: "This template is no longer the current one",
    summary: "The template was retired after this draft was opened. The older wording stays readable in the history.",
    decision: "Choose the current version",
    availability: "Unavailable until resolved",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "session-expiry",
    label: "Session expiry",
    title: "The session has expired",
    summary: "The session ended before this could finish, so nothing was changed. Sign in again to carry on.",
    decision: "Sign in again",
    availability: "Unavailable until resolved",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "session-gate",
    desktopModality: "session-gate",
    dismissal: "recovery-only",
  },
  {
    id: "offline-banner",
    label: "Offline banner",
    title: "There is no connection",
    summary:
      "Without a connection nothing can be started or changed, and no patient detail is kept on this device for later.",
    decision: "Try connecting again",
    availability: "Unavailable until resolved",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "status-banner",
    desktopModality: "status-banner",
    dismissal: "recovery-only",
  },
  {
    id: "recoverable-error",
    label: "Recoverable error",
    title: "Those records could not be loaded",
    summary: "Nothing about the plan or its deliveries has changed. Try the same page again.",
    decision: "Try loading again",
    availability: "Available",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "permission-unavailable",
    label: "Permission unavailable",
    title: "This action is not available to you",
    summary: "This role cannot carry out this action. The attempt is recorded and nothing has changed.",
    decision: "Back to the plan",
    availability: "Unavailable until resolved",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "team-switcher",
    label: "Team switcher",
    title: "Switch to another team",
    summary: "Switching team clears the selected patient and every draft for that patient before the new team appears.",
    decision: "Clear and switch team",
    availability: "Available",
    mutatesState: true,
    requiresFreshAuthentication: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "draft-version-conflict",
    label: "Draft version conflict",
    title: "This draft and the approved version differ",
    summary:
      "An approved template changed after this draft was opened. Compare the two; neither is overwritten on its own.",
    decision: "Review the current version",
    availability: "Unavailable until resolved",
    mutatesState: false,
    requiresFreshAuthentication: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
] satisfies readonly WorkspaceOverlayDefinition[]);

/** The 16 overlays whose confirmed action changes stored state, in matrix order. */
export const MUTATING_OVERLAY_IDS: readonly string[] = Object.freeze(
  WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => definition.mutatesState).map((definition) => definition.id),
);

const DEFINITION_BY_ID = new Map(WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => [definition.id, definition]));

/** Returns `null` rather than throwing: an unknown `?overlay=` value is a bad URL, not a defect. */
export function overlayDefinition(id: string): WorkspaceOverlayDefinition | null {
  return DEFINITION_BY_ID.get(id) ?? null;
}
