const fs = require('fs');

const p1 = '/Users/jamesharris/Library/Application Support/Code/User/workspaceStorage/5e00e439ec135dec93fec6fa05328d6f/GitHub.copilot-chat/chat-session-resources/7e966bf9-779b-4ed9-bb13-d406190f6853/call_7aBpE481kRhzYKpk0wxG1la7__vscode-1774290867868/content.json';
const p3 = '/Users/jamesharris/Library/Application Support/Code/User/workspaceStorage/5e00e439ec135dec93fec6fa05328d6f/GitHub.copilot-chat/chat-session-resources/7e966bf9-779b-4ed9-bb13-d406190f6853/call_AuI0e50eyRv2WbBhrkkiypz0__vscode-1774290867870/content.json';

function extract(raw) {
  const m = raw.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);
  if (!m) throw new Error('parse fail');
  return JSON.parse(m[1]);
}

const raw1 = JSON.parse(fs.readFileSync(p1, 'utf8')).result;
const raw3 = JSON.parse(fs.readFileSync(p3, 'utf8')).result;
const cols = extract(raw1);
const idx = extract(raw3);
const pk = [
  { table_name: 'earnings_events', column_name: 'id' },
  { table_name: 'market_metrics', column_name: 'symbol' },
  { table_name: 'market_quotes', column_name: 'symbol' },
  { table_name: 'news_articles', column_name: 'id' },
  { table_name: 'opportunity_stream', column_name: 'id' },
  { table_name: 'tradable_universe', column_name: 'symbol' },
  { table_name: 'trade_setups', column_name: 'symbol' }
];
const required = [
  'tradable_universe',
  'market_metrics',
  'market_quotes',
  'opportunity_stream',
  'news_articles',
  'earnings_events',
  'trade_setups'
];

const grouped = {};
for (const t of required) grouped[t] = { columns: [], primary_keys: [], indexes: [] };

for (const r of cols) {
  if (grouped[r.table_name]) {
    grouped[r.table_name].columns.push({
      column: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES'
    });
  }
}

for (const r of pk) {
  if (grouped[r.table_name]) grouped[r.table_name].primary_keys.push(r.column_name);
}

for (const r of idx) {
  if (grouped[r.table_name]) {
    grouped[r.table_name].indexes.push({
      name: r.index_name,
      definition: r.index_def
    });
  }
}

const missing = required.filter((t) => !grouped[t] || grouped[t].columns.length === 0);
const out = {
  generated_at: new Date().toISOString(),
  required_tables: required,
  missing_tables: missing,
  pass: missing.length === 0,
  tables: grouped
};

fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync('logs/db_schema_truth.json', JSON.stringify(out, null, 2));
console.log('ok logs/db_schema_truth.json missing=' + missing.length);
if (missing.length > 0) process.exit(1);
