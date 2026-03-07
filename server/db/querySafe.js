const db = require('./index');

async function querySafe(text, params = []) {
  try {
    const result = await db.query(text, params);

    return result;
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

module.exports = querySafe;
