import { permanentRedirect } from "next/navigation";

/**
 * Backstop: the evidence folder is now part of the Term page (owner-approved mock-up, 11 Oct 2026).
 * The proxy's redirect normally answers first; this catches anything its matcher misses.
 */
export default function TeachingTermFolderBackstop() {
  permanentRedirect("/teaching/term");
}
