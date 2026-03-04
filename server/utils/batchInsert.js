const { warn } = require('./logger');

const DEFAULT_BATCH_SIZE = 500;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function batchInsert({
  supabase,
  table,
  rows,
  conflictTarget,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  if (!supabase) {
    throw new Error('Supabase admin client is not initialized');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, batches: 0 };
  }

  let inserted = 0;
  let batches = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize);
    batches += 1;

    let attempt = 0;
    let done = false;

    while (!done && attempt < MAX_RETRIES) {
      attempt += 1;

      const query = supabase
        .from(table)
        .upsert(chunk, {
          onConflict: conflictTarget,
          ignoreDuplicates: false,
        });

      const { error } = await query;
      if (!error) {
        inserted += chunk.length;
        done = true;
        break;
      }

      warn('Batch insert retry', {
        table,
        attempt,
        error: error.message,
      });

      if (attempt < MAX_RETRIES) {
        await sleep(250 * 2 ** (attempt - 1));
      }
    }

    if (!done) {
      throw new Error(`Batch insert failed for table ${table} after ${MAX_RETRIES} retries`);
    }
  }

  return { inserted, batches };
}

module.exports = {
  batchInsert,
};
