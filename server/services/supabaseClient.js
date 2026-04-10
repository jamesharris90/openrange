const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasValidSupabaseUrl = Boolean(
  SUPABASE_URL
  && SUPABASE_URL !== 'REQUIRED'
  && /^https?:\/\//i.test(SUPABASE_URL)
);
const hasValidSupabaseAnonKey = Boolean(
  SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'REQUIRED'
);
const hasValidSupabasePublishableKey = Boolean(
  SUPABASE_PUBLISHABLE_KEY && SUPABASE_PUBLISHABLE_KEY !== 'REQUIRED'
);
const hasValidSupabaseServiceRoleKey = Boolean(
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY !== 'REQUIRED'
);
const supabaseClientKey = hasValidSupabaseAnonKey
  ? SUPABASE_ANON_KEY
  : (hasValidSupabasePublishableKey ? SUPABASE_PUBLISHABLE_KEY : SUPABASE_SERVICE_ROLE_KEY);
const hasValidSupabaseClientKey = Boolean(supabaseClientKey);

if (!hasValidSupabaseUrl) {
  console.warn('[Startup Warning] SUPABASE_URL is not configured. Supabase-dependent features may be unavailable.');
}

if (!hasValidSupabaseServiceRoleKey) {
  console.warn('[Startup Warning] SUPABASE_SERVICE_ROLE_KEY is not configured. Supabase-dependent features may be unavailable.');
}

if (!hasValidSupabaseAnonKey && !hasValidSupabasePublishableKey) {
  console.warn('[Startup Warning] Neither SUPABASE_ANON_KEY nor SUPABASE_KEY is configured. Falling back to service-role key for client-level Supabase routes.');
}

const supabaseClient = hasValidSupabaseUrl && hasValidSupabaseAnonKey
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : (hasValidSupabaseUrl && hasValidSupabaseClientKey
    ? createClient(SUPABASE_URL, supabaseClientKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null);

const supabaseAdmin = hasValidSupabaseUrl && hasValidSupabaseServiceRoleKey
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

if (supabaseClient) {
  console.log('✅ Supabase connected:', process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL);
}

module.exports = {
  supabaseClient,
  supabaseAdmin,
};
