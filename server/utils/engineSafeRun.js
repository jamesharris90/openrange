module.exports = async function safeEngineRun(name, fn) {
  try {
    console.log(`[ENGINE START] ${name}`);
    await fn();
    console.log(`[ENGINE OK] ${name}`);
  } catch (err) {
    console.error(`[ENGINE FAIL] ${name}`, err.message);
  }
};
