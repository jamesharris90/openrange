const { supabaseAdmin } = require('../../services/supabaseClient');

async function getNewsRows() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  const { data, error } = await supabaseAdmin
    .from('latest_news_cache')
    .select('symbol, headline, source, published_at')
    .order('published_at', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message || 'Failed to load latest news cache');
  }

  return (data || []).map((row) => ({
    symbol: row.symbol || null,
    headline: row.headline || null,
    source: row.source || null,
    published_at: row.published_at || null,
  }));
}

module.exports = {
  getNewsRows,
};