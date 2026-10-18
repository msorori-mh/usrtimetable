import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";
import { SUPER_ADMIN_POLICY, verifyCallerAccess, type CallerClient } from "@/lib/admin-access";

/**
 * H-11: middleware for every super-admin server function that later uses the
 * service-role client. On top of JWT validation (requireSupabaseAuth) it
 * proves, with the caller's own RLS-bound client, that:
 *   - the session is valid (not revoked), MFA is satisfied and no temporary
 *     password change is pending (security_access_status),
 *   - the JWT is aal2 (MFA-verified in this session),
 *   - the caller holds super_admin (read through RLS, not the admin client).
 * Any failure (including an unreachable RPC) denies with a fixed Arabic message.
 */
export const requireSecureAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    await verifyCallerAccess(
      context.supabase as unknown as CallerClient,
      context.userId,
      context.claims,
      SUPER_ADMIN_POLICY,
    );
    return next({ context: { secureAdminVerified: true as const } });
  });
