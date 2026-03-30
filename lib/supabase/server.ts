import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server client — uses anon key + cookie session.
 * Use in Server Components, Server Actions, and Route Handlers that need the
 * authenticated user's identity (RLS applies).
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — cookie mutation is a no-op here,
            // the middleware will refresh the session instead.
          }
        },
      },
    },
  );
}
