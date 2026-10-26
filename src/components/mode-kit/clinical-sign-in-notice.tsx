"use client";

import { FileCheck } from "lucide-react";

import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import { WorkButton } from "@/components/mode-kit/work";
import { WorkSignInLine, WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import {
  CLINICAL_DECLARATION_COPY,
  CLINICAL_SIGN_IN_INVITE_NOTE,
  type ClinicalSignInCopy,
} from "@/lib/front-door-content";
import { requestTermsPrompt } from "@/lib/terms-acceptance";

/**
 * D26-07: the same card for a signed-in account that has not made the health professional
 * declaration. It names what is missing and reopens the Terms prompt instead of Sign in.
 */
function ClinicalDeclarationNotice({
  line,
  bare,
  testId,
}: {
  readonly line?: boolean;
  readonly bare?: boolean;
  readonly testId?: string;
}) {
  const declarationTestId = testId ? `${testId}-declaration` : undefined;
  const review = (
    <WorkButton
      icon={FileCheck}
      onClick={requestTermsPrompt}
      testId={declarationTestId ? `${declarationTestId}-review` : undefined}
    >
      {CLINICAL_DECLARATION_COPY.action}
    </WorkButton>
  );
  if (line) {
    return (
      <div
        className="work-card flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pr-1.5 pl-3"
        data-testid={declarationTestId}
      >
        <p className="m-0 min-w-0 flex-1 basis-44 py-2 text-sm font-medium break-words text-[color:var(--text-heading)]">
          {CLINICAL_DECLARATION_COPY.title}
        </p>
        {review}
      </div>
    );
  }
  return (
    <WorkStateNotice
      kind="signed-out"
      icon={FileCheck}
      title={CLINICAL_DECLARATION_COPY.title}
      body={CLINICAL_DECLARATION_COPY.body}
      action={review}
      bare={bare}
      testId={declarationTestId}
    />
  );
}

/**
 * The locked card for a clinical decision tool (see `useClinicalToolAccess`). Signed out: what
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
  if (useClinicalToolAccess() === "declaration-required") {
    return <ClinicalDeclarationNotice line={line} bare={bare} testId={testId} />;
  }
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
