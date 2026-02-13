const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'users.db');

/**
 * Database migration system
 * Keeps track of applied migrations and runs pending ones
 */
class MigrationManager {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize the migration system
   * Creates migrations tracking table if it doesn't exist
   */
  init() {
    this.db = new Database(this.dbPath);

    // Create migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations() {
    const rows = this.db.prepare('SELECT name FROM migrations ORDER BY id').all();
    return rows.map(row => row.name);
  }

  /**
   * Get list of available migration files
   */
  getAvailableMigrations() {
    const migrationsDir = path.join(__dirname, 'migrations');

    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort alphabetically (by timestamp if named correctly)

    return files;
  }

  /**
   * Get pending migrations (not yet applied)
   */
  getPendingMigrations() {
    const applied = new Set(this.getAppliedMigrations());
    const available = this.getAvailableMigrations();

    return available.filter(name => !applied.has(name));
  }

  /**
   * Run a single migration
   */
  runMigration(filename) {
    const migrationsDir = path.join(__dirname, 'migrations');
    const filepath = path.join(migrationsDir, filename);

    const sql = fs.readFileSync(filepath, 'utf8');

    // Run migration in a transaction
    const transaction = this.db.transaction(() => {
      this.db.exec(sql);
      this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(filename);
    });

    transaction();
  }

  /**
   * Run all pending migrations
   */
  migrate() {
    this.init();

    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)...`);

    for (const migration of pending) {
      try {
        console.log(`  Applying: ${migration}`);
        this.runMigration(migration);
        console.log(`  ✓ Applied: ${migration}`);
      } catch (error) {
        console.error(`  ✗ Failed: ${migration}`);
        console.error(`  Error: ${error.message}`);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  }

  /**
   * Rollback last migration (WARNING: This doesn't run down migrations)
   */
  rollback() {
    const lastMigration = this.db.prepare('SELECT name FROM migrations ORDER BY id DESC LIMIT 1').get();

    if (!lastMigration) {
      console.log('No migrations to rollback');
      return;
    }

    console.warn('WARNING: This only removes the migration record, it does not run down migrations');
    console.warn(`To rollback ${lastMigration.name}, you must manually reverse the changes`);

    this.db.prepare('DELETE FROM migrations WHERE name = ?').run(lastMigration.name);
    console.log(`Removed migration record: ${lastMigration.name}`);
  }

  /**
   * Show migration status
   */
  status() {
    this.init();

    const applied = this.getAppliedMigrations();
    const pending = this.getPendingMigrations();

    console.log('\n=== Migration Status ===\n');

    if (applied.length > 0) {
      console.log('Applied migrations:');
      applied.forEach(name => console.log(`  ✓ ${name}`));
    }

    if (pending.length > 0) {
      console.log('\nPending migrations:');
      pending.forEach(name => console.log(`  ○ ${name}`));
    } else {
      console.log('\nNo pending migrations');
    }

    console.log('');
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = MigrationManager;

// CLI support
if (require.main === module) {
  const manager = new MigrationManager();
  const command = process.argv[2] || 'status';

  try {
    switch (command) {
      case 'migrate':
      case 'up':
        manager.migrate();
        break;
      case 'rollback':
      case 'down':
        manager.rollback();
        break;
      case 'status':
        manager.status();
        break;
      default:
        console.log('Usage: node migrations.js [migrate|rollback|status]');
        process.exit(1);
    }
    manager.close();
  } catch (error) {
    console.error('Migration error:', error.message);
    manager.close();
    process.exit(1);
  }
}
