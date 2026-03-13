'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasUrl = Boolean(supabaseUrl && /^https?:\/\//i.test(String(supabaseUrl)));
const hasServiceKey = Boolean(supabaseServiceRoleKey);

if (!hasUrl) {
  console.warn('[SUPABASE] SUPABASE_URL is missing or invalid.');
}

if (!hasServiceKey) {
  console.warn('[SUPABASE] SUPABASE_SERVICE_ROLE_KEY is missing.');
}

const supabaseClient = hasUrl && hasServiceKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

module.exports = {
  supabaseClient,
};
