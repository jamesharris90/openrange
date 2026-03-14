-- Schema-only dump for schema "public"
-- Repaired/normalized SQL (idempotent, executable)

BEGIN;

-- 1) Ensure schema exists
CREATE SCHEMA IF NOT EXISTS public;
ALTER SCHEMA public OWNER TO postgres;

-- 2) SEQUENCES
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      seq.oid,
      n.nspname AS schemaname,
      seq.relname AS sequencename,
      pg_get_userbyid(seq.relowner) AS owner
    FROM pg_class seq
    JOIN pg_namespace n ON n.oid = seq.relnamespace
    WHERE n.nspname = 'public'
      AND seq.relkind = 'S'
    ORDER BY seq.relname
  LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I.%I;', r.schemaname, r.sequencename);
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I;', r.schemaname, r.sequencename, r.owner);
  END LOOP;
END
$$;

-- 3) TABLES
-- Helper to emit CREATE TABLE statements.
CREATE OR REPLACE FUNCTION pg_get_tabledef(p_oid oid)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_schema text;
  v_table text;
  v_cols text := '';
  v_sql text;
BEGIN
  SELECT n.nspname, c.relname
    INTO v_schema, v_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = p_oid;

  v_sql := format('CREATE TABLE IF NOT EXISTS %I.%I (', v_schema, v_table);

  SELECT string_agg(coldef, E',\n  ')
    INTO v_cols
  FROM (
    SELECT format(
      '%I %s%s%s%s',
      a.attname,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      CASE
        WHEN a.attgenerated = 's' THEN ' GENERATED ALWAYS AS (' || pg_get_expr(ad.adbin, ad.adrelid) || ') STORED'
        WHEN a.attidentity IN ('a', 'd') THEN ' GENERATED ' || CASE a.attidentity WHEN 'a' THEN 'ALWAYS' ELSE 'BY DEFAULT' END || ' AS IDENTITY'
        WHEN ad.adbin IS NOT NULL THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid)
        ELSE ''
      END,
      CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
      CASE WHEN a.attcollation <> pg_database_collation() THEN ' COLLATE ' || quote_ident(coll.collname) ELSE '' END
    ) AS coldef
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
    WHERE n.nspname = v_schema
      AND c.relname = v_table
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  ) s;

  v_sql := v_sql || COALESCE(E'\n  ' || v_cols, '') || E'\n);';
  RETURN v_sql;
END
$fn$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.oid,
      n.nspname AS schemaname,
      c.relname AS tablename,
      pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE pg_get_tabledef(r.oid);
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I;', r.schemaname, r.tablename, r.owner);
  END LOOP;
END
$$;

-- 4) PRIMARY KEYS, UNIQUE, CHECK, EXCLUSION (FKs later)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      con.oid,
      n.nspname,
      c.relname AS tablename,
      con.conname,
      con.contype,
      pg_get_constraintdef(con.oid, true) AS condef
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype IN ('p', 'u', 'c', 'x')
    ORDER BY c.relname, con.conname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c2
      WHERE c2.conname = r.conname
        AND c2.conrelid = format('%I.%I', r.nspname, r.tablename)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
        r.nspname,
        r.tablename,
        r.conname,
        r.condef
      );
    END IF;
  END LOOP;
END
$$;

-- 5) FOREIGN KEYS
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      con.oid,
      n.nspname,
      c.relname AS tablename,
      con.conname,
      pg_get_constraintdef(con.oid, true) AS condef
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype = 'f'
    ORDER BY c.relname, con.conname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c2
      WHERE c2.conname = r.conname
        AND c2.conrelid = format('%I.%I', r.nspname, r.tablename)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
        r.nspname,
        r.tablename,
        r.conname,
        r.condef
      );
    END IF;
  END LOOP;
END
$$;

-- 6) INDEXES (excluding those backing constraints)
DO $$
DECLARE
  r RECORD;
  idx_sql text;
BEGIN
  FOR r IN
    SELECT
      n.nspname,
      t.relname AS tablename,
      i.relname AS indexname,
      pg_get_indexdef(i.oid) AS idxdef
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = i.oid
    WHERE n.nspname = 'public'
      AND con.oid IS NULL
    ORDER BY t.relname, i.relname
  LOOP
    idx_sql := regexp_replace(r.idxdef, '^CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ');
    EXECUTE idx_sql;
  END LOOP;
END
$$;

-- 7) VIEWS
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.oid,
      n.nspname,
      c.relname AS viewname,
      pg_get_userbyid(c.relowner) AS owner,
      pg_get_viewdef(c.oid, true) AS vdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %I.%I AS %s;', r.nspname, r.viewname, r.vdef);
    EXECUTE format('ALTER VIEW %I.%I OWNER TO %I;', r.nspname, r.viewname, r.owner);
  END LOOP;
END
$$;

-- 8) MATERIALIZED VIEWS
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.oid,
      n.nspname,
      c.relname AS viewname,
      pg_get_userbyid(c.relowner) AS owner,
      pg_get_viewdef(c.oid, true) AS vdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'm'
    ORDER BY c.relname
  LOOP
    IF to_regclass(format('%I.%I', r.nspname, r.viewname)) IS NULL THEN
      EXECUTE format('CREATE MATERIALIZED VIEW %I.%I AS %s WITH NO DATA;', r.nspname, r.viewname, r.vdef);
    END IF;
    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I;', r.nspname, r.viewname, r.owner);
  END LOOP;
END
$$;

-- 9) TRIGGER FUNCTIONS (in public and referenced by public triggers)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      n.nspname,
      p.proname,
      pg_get_functiondef(p.oid) AS fndef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n2 ON n2.oid = c.relnamespace
        WHERE n2.nspname = 'public'
          AND t.tgfoid = p.oid
      )
  LOOP
    EXECUTE r.fndef;
  END LOOP;
END
$$;

-- 10) TRIGGERS
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      t.oid,
      n.nspname,
      c.relname AS tablename,
      t.tgname AS triggername,
      pg_get_triggerdef(t.oid, true) AS tgdef
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t2
      JOIN pg_class c2 ON c2.oid = t2.tgrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = r.nspname
        AND c2.relname = r.tablename
        AND t2.tgname = r.triggername
        AND NOT t2.tgisinternal
    ) THEN
      EXECUTE r.tgdef;
    END IF;
  END LOOP;
END
$$;

-- 11) COMMENTS (tables, views, matviews, columns)
DO $$
DECLARE
  r RECORD;
BEGIN
  -- table/view/mview comments
  FOR r IN
    SELECT
      obj_description(c.oid) AS comment,
      c.relkind,
      format('%I.%I', n.nspname, c.relname) AS fqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND obj_description(c.oid) IS NOT NULL
  LOOP
    EXECUTE format(
      'COMMENT ON %s %s IS %L;',
      CASE r.relkind
        WHEN 'r' THEN 'TABLE'
        WHEN 'p' THEN 'TABLE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
      END,
      r.fqname,
      r.comment
    );
  END LOOP;

  -- column comments
  FOR r IN
    SELECT
      col_description(a.attrelid, a.attnum) AS comment,
      format('%I.%I', n.nspname, c.relname) AS fqname,
      a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND col_description(a.attrelid, a.attnum) IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON COLUMN %s.%I IS %L;', r.fqname, r.attname, r.comment);
  END LOOP;
END
$$;

COMMIT;
