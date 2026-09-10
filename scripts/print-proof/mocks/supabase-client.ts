/**
 * Full-shell print proof — inert stand-in for the generated Supabase client.
 *
 * The proof fixture mounts the REAL AppLayout, which imports the client only to
 * call `auth.signOut()` from the sign-out button. The fixture never signs out and
 * must never touch a real backend, so this module exposes just enough surface to
 * satisfy the import and throws if anything tries to read data.
 */
export const supabase = {
  auth: {
    signOut: async () => ({ error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from() {
    throw new Error("print-proof shell fixture: no database access is allowed");
  },
} as const;
