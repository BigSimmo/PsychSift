"use client";

import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";

const COPY = {
  "on-call": {
    title: "Sign in to see your On Call",
    body: "Below is a sample made of invented examples, so you can see how On Call works. Signed in, it shows your own hospital's numbers and your own entries. Nothing is shared, and the sample numbers cannot be called.",
    testId: "on-call-signed-out-sample",
  },
  admin: {
    title: "Sign in to see your Admin",
    body: "Below is a sample made of invented examples, so you can see how Admin works. Signed in, it shows your own renewals and records. Nothing is shared, and the sample doesn't save.",
    testId: "admin-signed-out-sample",
  },
} as const;

export default function OnCallSampleNoticeBox({ mode }: { readonly mode: "on-call" | "admin" }) {
  const copy = COPY[mode];
  return (
    <SignedOutSampleNotice title={copy.title} testId={copy.testId}>
      {copy.body}
    </SignedOutSampleNotice>
  );
}
