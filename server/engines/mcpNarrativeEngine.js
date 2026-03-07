const db = require('../db');
const { getMcpClient } = require('../mcp/fmpClient');

function normalizeToolPayload(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result[0] || null;
  if (Array.isArray(result?.content) && result.content.length > 0) {
    const first = result.content[0];
    if (typeof first === 'string') {
      try {
        return JSON.parse(first);
      } catch (_err) {
        return null;
      }
    }
    if (first?.text) {
      try {
        return JSON.parse(first.text);
      } catch (_err) {
        return null;
      }
    }
    return first;
  }
  return result;
}

async function callToolSafe(client, name, payload) {
  try {
    if (!client || typeof client.call_tool !== 'function') return null;
    const response = await client.call_tool(name, payload);
    return normalizeToolPayload(response);
  } catch (_err) {
    return null;
  }
}

async function runMcpNarrativeEngine() {
  let client = null;

  try {
    const signalsResult = await db.query(
      `SELECT id, symbol, strategy, updated_at
       FROM strategy_signals
       WHERE updated_at > NOW() - INTERVAL '24 hours'`
    );

    const signals = Array.isArray(signalsResult?.rows) ? signalsResult.rows : [];
    console.log(`[MCP] signals analysed: ${signals.length}`);

    client = await getMcpClient();
    if (!client) {
      console.warn('[MCP] context skipped, client unavailable');
      return { signalsAnalysed: signals.length, contextAttached: 0, skipped: true };
    }

    let contextAttached = 0;

    for (const signal of signals) {
      const narrativeResult = await db.query(
        `SELECT id, mcp_context
         FROM signal_narratives
         WHERE signal_id = $1
         LIMIT 1`,
        [signal.id]
      );

      if (narrativeResult.rows.length === 0) {
        continue;
      }

      const narrative = narrativeResult.rows[0];
      if (narrative.mcp_context) {
        continue;
      }

      const quote = await callToolSafe(client, 'quote', { symbol: signal.symbol });
      const income = await callToolSafe(client, 'income_statement', { symbol: signal.symbol });
      const balance = await callToolSafe(client, 'balance_sheet', { symbol: signal.symbol });
      const earnings = await callToolSafe(client, 'earnings_calendar', { symbol: signal.symbol });

      const context = {
        price: quote?.price ?? quote?.c ?? null,
        sector: quote?.sector ?? income?.sector ?? balance?.sector ?? null,
        earnings_date: earnings?.date ?? earnings?.earningsDate ?? null,
        market_cap: quote?.marketCap ?? quote?.market_cap ?? balance?.marketCap ?? null,
      };

      await db.query(
        `UPDATE signal_narratives
         SET mcp_context = $2::jsonb
         WHERE id = $1`,
        [narrative.id, JSON.stringify(context)]
      );

      contextAttached += 1;
    }

    console.log(`[MCP] context attached: ${contextAttached}`);
    return { signalsAnalysed: signals.length, contextAttached };
  } catch (e) {
    console.error('[ENGINE ERROR]', e.message);
    return { signalsAnalysed: 0, contextAttached: 0, error: e.message };
  } finally {
    try {
      if (client && typeof client.close === 'function') {
        await client.close();
      }
    } catch (_err) {
      // ignore close errors
    }
  }
}

module.exports = { runMcpNarrativeEngine };