import { redirect } from "next/navigation";

// The doctor record lives inside the Assessments page. This address stays so older links still land.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const query = await searchParams;
  const tab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  redirect(tab === "history" ? "/teaching/assessments?view=all" : "/teaching/assessments?view=record");
}
