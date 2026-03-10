#!/usr/bin/env node

const { createRequire } = require('node:module');

// Support monorepo-style installs where deps may exist in root or server/.
const localRequire = createRequire(__filename);
const serverRequire = createRequire(require('node:path').resolve(__dirname, '../server/package.json'));

function loadDep(name) {
  try {
    return localRequire(name);
  } catch (_) {
    return serverRequire(name);
  }
}

const dotenv = loadDep('dotenv');
dotenv.config({ path: 'server/.env' });

const bcrypt = loadDep('bcrypt');
const { createClient } = loadDep('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL === 'REQUIRED' || SUPABASE_SERVICE_ROLE_KEY === 'REQUIRED') {
  console.error('Missing Supabase environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function repairAdmin() {
  try {
    const NEW_PASSWORD = process.env.OPENRANGE_ADMIN_PASSWORD || 'OpenRange123!';
    const TARGET_USERNAME = process.env.OPENRANGE_ADMIN_USERNAME || 'jamesharris';

    console.log('Generating bcrypt hash...');
    const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);
    console.log('Hash generated.');

    console.log('Updating admin user...');
    const { data, error } = await supabase
      .from('users')
      .update({
        password: passwordHash,
        is_admin: 1,
        plan: 'admin',
        is_active: 1
      })
      .eq('username', TARGET_USERNAME)
      .select();

    if (error) {
      console.error('Update failed:', error);
      process.exitCode = 1;
      return;
    }

    if (!data || data.length === 0) {
      console.error(`No user row was updated for username: ${TARGET_USERNAME}`);
      process.exitCode = 1;
      return;
    }

    console.log('User updated successfully.');

    console.log('Verifying admin record...');
    const { data: verify, error: verifyError } = await supabase
      .from('users')
      .select('id, username, email, is_admin, plan, is_active')
      .eq('username', TARGET_USERNAME);

    if (verifyError) {
      console.error('Verification failed:', verifyError);
      process.exitCode = 1;
      return;
    }

    console.log('Verification result:');
    console.table(verify);

    console.log('');
    console.log('Login credentials repaired.');
    console.log(`Username: ${TARGET_USERNAME}`);
    console.log(`Password: ${NEW_PASSWORD}`);
  } catch (err) {
    console.error('Repair script error:', err);
    process.exitCode = 1;
  }
}

repairAdmin();
