// Originally generated; hardened for L-5 (no env names / backend details reach the
// browser). Keep the request contract identical when regenerating.
import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

export const UNAUTHORIZED_AR = 'انتهت الجلسة أو لم يتم التحقق من هويتك. سجّل الدخول مجددًا.'
export const SERVER_UNAVAILABLE_AR = 'الخدمة غير متاحة مؤقتًا. أعد المحاولة لاحقًا.'


export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      const missing = [
        ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
        ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
      ];
      // Server-side detail only; the client receives a fixed message.
      console.error(`[Supabase] Missing environment variable(s): ${missing.join(', ')}`);
      throw new Error(SERVER_UNAVAILABLE_AR);
    }
    
    const request = getRequest();

    if (!request?.headers) {
      throw new Error(UNAUTHORIZED_AR);
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new Error(UNAUTHORIZED_AR);
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error(UNAUTHORIZED_AR);
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      throw new Error(UNAUTHORIZED_AR);
    }

    const supabase = createClient<Database>(
      SUPABASE_URL!,
      SUPABASE_PUBLISHABLE_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      throw new Error(UNAUTHORIZED_AR);
    }

    if (!data.claims.sub) {
      throw new Error(UNAUTHORIZED_AR);
    }

    return next({
      context: {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
