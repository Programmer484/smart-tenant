import { createBrowserClient } from "@supabase/ssr";

/** Browser client — uses anon key, respects RLS, safe in client components. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
