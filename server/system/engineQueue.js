const queue = [];
let running = false;

async function runNext() {
  if (running || queue.length === 0) return;

  running = true;

  const job = queue.shift();

  try {
    await job();
  } catch (err) {
    console.error('[ENGINE ERROR]', err.message);
  }

  running = false;

  runNext();
}

function addEngineJob(job) {
  queue.push(job);

  runNext();
}

module.exports = addEngineJob;
