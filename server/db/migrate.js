#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('./pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(50) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map(r => r.version));
}

async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = file.replace('.sql', '');
    if (applied.has(version)) {
      console.log(`  skip: ${version} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`  applying: ${version}...`);
    await pool.query(sql);
    count++;
    console.log(`  applied: ${version}`);
  }

  if (count === 0) {
    console.log('All migrations already applied.');
  } else {
    console.log(`Applied ${count} migration(s).`);
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err.message || err);
    console.error(err.stack || err);
    process.exit(1);
  });
