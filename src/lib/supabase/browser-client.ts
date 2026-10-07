import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Supabase browser library (about 70 KB gzip with auth, storage, realtime and
// postgrest) lives in this module so AuthProvider can load it after first paint
// instead of every page parsing it before it can draw. See src/lib/supabase/client.tsx.

let cached: { configKey: string; client: SupabaseClient } | null = null;

export function browserSupabaseClientFor(url: string, publishableKey: string): SupabaseClient {
  const configKey = `${url}:${publishableKey}`;
  if (cached?.configKey === configKey) return cached.client;
  // @supabase/ssr browser client persists the session in cookies shared with the
  // server (proxy + route handlers), so logins survive refreshes and the API can
  // read the session. PKCE code flow returns via /auth/callback.
  const client = createBrowserClient(url, publishableKey);
  cached = { configKey, client };
  return client;
}
