# Database Migrations

This directory contains database migration files for the OpenRange Trader user system.

## How It Works

The migration system tracks which migrations have been applied to the database using a `migrations` table. Each migration is a SQL file that is run exactly once.

## Migration File Naming Convention

Migration files should be named using the following pattern:

```
{sequence}_{description}.sql
```

Examples:
- `001_create_users_table.sql`
- `002_add_email_verified_column.sql`
- `003_add_user_preferences_table.sql`

The sequence number ensures migrations are run in the correct order.

## Running Migrations

### Check migration status
```bash
cd server/users
node migrations.js status
```

### Run pending migrations
```bash
cd server/users
node migrations.js migrate
```

### Rollback last migration record
```bash
cd server/users
node migrations.js rollback
```

**Note:** Rollback only removes the migration tracking record. You must manually write and run a down migration to reverse schema changes.

## Creating a New Migration

1. Create a new SQL file in this directory with the next sequence number
2. Write your DDL statements (CREATE, ALTER, etc.)
3. Run `node migrations.js migrate` to apply it

Example migration file (`002_add_email_verified.sql`):

```sql
-- Add email verification column
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN verification_token TEXT;

-- Create index for faster lookups
CREATE INDEX idx_users_verification_token ON users(verification_token);
```

## Best Practices

1. **Never edit applied migrations** - Once a migration has been applied to production, create a new migration to make changes
2. **Keep migrations small** - One logical change per migration
3. **Test migrations** - Test on a copy of the database first
4. **Use transactions** - Migrations are run in transactions automatically
5. **Write descriptive names** - Make it clear what each migration does

## Automatic Migration on Startup

To run migrations automatically when the server starts, add this to `server/index.js`:

```javascript
const MigrationManager = require('./users/migrations');

// Run migrations on startup
const migrations = new MigrationManager();
migrations.migrate();
migrations.close();
```
