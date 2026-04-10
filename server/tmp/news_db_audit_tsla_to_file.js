require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const outputPath = path.join(__dirname, 'news_db_audit_tsla_output.json');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const result = {};

  async function capture(name, sql, params = []) {
    const { rows } = await pool.query(sql, params);
    result[name] = rows;
  }

  await capture('table_exists', `
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('news_articles','news_events','intel_news')
    order by table_name
  `);

  await capture('news_articles_columns', `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'news_articles'
      and column_name in ('symbol','symbols','headline','source','url','published_at','created_at')
    order by column_name
  `);

  await capture('table_counts_and_latest', `
    select 'news_articles' as table_name, count(*)::bigint as rows, max(published_at) as latest_published_at from news_articles
    union all
    select 'news_events' as table_name, count(*)::bigint as rows, max(published_at) as latest_published_at from news_events
    union all
    select 'intel_news' as table_name, count(*)::bigint as rows, max(published_at) as latest_published_at from intel_news
  `);

  await capture('recent_counts', `
    select 'news_articles_24h' as metric, count(*)::bigint as count from news_articles where published_at >= now() - interval '24 hours'
    union all
    select 'news_articles_48h' as metric, count(*)::bigint as count from news_articles where published_at >= now() - interval '48 hours'
    union all
    select 'news_articles_7d' as metric, count(*)::bigint as count from news_articles where published_at >= now() - interval '7 days'
    union all
    select 'tsla_news_articles_24h' as metric, count(*)::bigint as count from news_articles where upper(coalesce(symbol,'')) = 'TSLA' and published_at >= now() - interval '24 hours'
    union all
    select 'tsla_news_articles_7d' as metric, count(*)::bigint as count from news_articles where upper(coalesce(symbol,'')) = 'TSLA' and published_at >= now() - interval '7 days'
    union all
    select 'tsla_news_articles_total' as metric, count(*)::bigint as count from news_articles where upper(coalesce(symbol,'')) = 'TSLA'
    union all
    select 'tsla_intel_news_24h' as metric, count(*)::bigint as count from intel_news where upper(coalesce(symbol,'')) = 'TSLA' and published_at >= now() - interval '24 hours'
    union all
    select 'tsla_news_events_24h' as metric, count(*)::bigint as count from news_events where upper(coalesce(symbol,'')) = 'TSLA' and published_at >= now() - interval '24 hours'
  `);

  await capture('tsla_latest_articles', `
    select upper(coalesce(symbol,'')) as symbol, headline, source, url, published_at
    from news_articles
    where upper(coalesce(symbol,'')) = 'TSLA'
    order by published_at desc nulls last
    limit 20
  `);

  await capture('latest_news_articles', `
    select upper(coalesce(symbol,'')) as symbol, headline, source, url, published_at
    from news_articles
    order by published_at desc nulls last
    limit 20
  `);

  await capture('latest_news_articles_with_tsla_symbols', `
    select upper(coalesce(symbol,'')) as symbol, headline, source, url, published_at
    from news_articles
    where headline ilike '%Tesla%' or headline ilike '%TSLA%'
    order by published_at desc nulls last
    limit 20
  `);

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    fs.writeFileSync(outputPath, JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  });
