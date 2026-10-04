import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Primer } from "@/components/first-nations/primer";
import { ReadingTrustSheet } from "@/components/first-nations/reading-trust-sheet";

const newsreader = localFont({
  src: "../../../fonts/newsreader-latin-400-italic.woff2",
  weight: "400",
  style: "italic",
  display: "swap",
  preload: false,
  fallback: ["ui-serif", "Georgia", "serif"],
  variable: "--font-fn-serif",
});

export default function FirstNationsLayout({ children }: { children: ReactNode }) {
  // `contents` keeps the shell's layout chain intact; the variable still inherits.
  // Primer and reading-trust live here so every page's ••• (and the example line) can open them.
  return (
    <div className={`${newsreader.variable} contents`}>
      <Primer />
      <ReadingTrustSheet />
      {children}
    </div>
  );
}
