async function safeQuery(db, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (err) {
    console.error('[SAFE QUERY ERROR]', err.message);
    return [];
  }
}

module.exports = {
  safeQuery,
};
