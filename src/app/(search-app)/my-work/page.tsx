import { redirect } from "next/navigation";

/**
 * Backstop: My Work became Admin (Admin update 1), and Admin opens on Today
 * again (work-mode redesign, owner request 6 Oct 2026). The proxy's 307
 * normally answers first and carries the query string; so does this, for the
 * rare request that reaches the page without passing through it.
 */
type MyWorkBackstopProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyWorkBackstop({ searchParams }: MyWorkBackstopProps) {
  const params = searchParams ? await searchParams : {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item);
    }
  }
  const suffix = query.toString();
  redirect(suffix ? `/admin?${suffix}` : "/admin");
}
