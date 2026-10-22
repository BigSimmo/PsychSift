"use client";

import { WorkSignInLine, WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import { CLINICAL_SIGN_IN_INVITE_NOTE, type ClinicalSignInCopy } from "@/lib/front-door-content";

/**
 * The signed-out card for a clinical decision tool (see `useClinicalToolAccess`): what
 * needs sign-in, who it is for, what stays open, and the app's own sign-in dialog.
 * `onSignedIn` runs once a sign-in started here succeeds, so the tool can carry on.
 * `line` draws only the title and Sign in, for a strip that sits above a list.
 */
export function ClinicalSignInNotice({
  copy,
  onSignedIn,
  bare,
  line,
  testId,
}: {
  readonly copy: ClinicalSignInCopy;
  readonly onSignedIn?: () => void;
  readonly bare?: boolean;
  readonly line?: boolean;
  readonly testId?: string;
}) {
  if (line) {
    return (
      <WorkSignInLine title={copy.title} testId={testId} signInTestId={testId ? `${testId}-sign-in` : undefined} />
    );
  }
  return (
    <WorkSignInNotice
      title={copy.title}
      body={
        <>
          {copy.body}
          {copy.stillOpen ? <span className="mt-1 block">{copy.stillOpen}</span> : null}
          <span className="mt-1 block">{CLINICAL_SIGN_IN_INVITE_NOTE}</span>
        </>
      }
      onSignedIn={onSignedIn}
      bare={bare}
      testId={testId}
      signInTestId={testId ? `${testId}-sign-in` : undefined}
    />
  );
}
