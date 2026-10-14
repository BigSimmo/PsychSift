import { notFound } from "next/navigation";
import { createSupabaseServerClient, publicSupabaseConfig } from "@/lib/supabase/server";
import { isAdministratorUser } from "@/lib/authorization";
import AdminPilot from "./pilot-client";

export const dynamic = "force-dynamic";

export default async function AdminPilotPage() {
  const client = await createSupabaseServerClient();
  if (!client) notFound();
  const { data, error } = await client.auth.getUser();
  if (error || !isAdministratorUser(data.user)) notFound();
  const config = publicSupabaseConfig();
  if (!config) notFound();
  return <main className="mx-auto max-w-2xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Administrator NHMRC source pilot</h1>
    <p>Verify your authenticator, then choose the approved NHMRC summary TXT or reviewed four-page native PDF. Each source needs its own admission and operator readback. Worker activation and publication remain separate operator steps.</p>
    <AdminPilot url={config.url} publishableKey={config.key} />
  </main>;
}
