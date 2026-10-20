"use client";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
/** Shared public crisis contacts for every On Call page. */
export function NowCrisisLines({ now, compact = false }: { readonly now?: Date; readonly compact?: boolean }) {
  return <OnCallCrisisLines now={now} compact={compact} testId="on-call-now-crisis" />;
}
