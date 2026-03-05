const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasValidSupabaseUrl = Boolean(
  SUPABASE_URL
  && SUPABASE_URL !== 'REQUIRED'
  && /^https?:\/\//i.test(SUPABASE_URL)
);
const hasValidSupabaseServiceRoleKey = Boolean(
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY !== 'REQUIRED'
);

if (!hasValidSupabaseUrl) {
  console.warn('[Startup Warning] SUPABASE_URL is not configured. Supabase-dependent features may be unavailable.');
}

if (!hasValidSupabaseServiceRoleKey) {
  console.warn('[Startup Warning] SUPABASE_SERVICE_ROLE_KEY is not configured. Supabase-dependent features may be unavailable.');
}

const supabaseAdmin = hasValidSupabaseUrl && hasValidSupabaseServiceRoleKey
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

module.exports = {
  supabaseAdmin,
};
