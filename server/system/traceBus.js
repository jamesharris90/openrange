const { randomUUID } = require('crypto');

const traces = new Map();

function startTrace(type) {
  const id = randomUUID();
  traces.set(id, {
    id,
    type,
    steps: [],
    started: Date.now(),
  });
  global.activeTraces = traces.size;
  return id;
}

function traceStep(id, step, data = {}) {
  const trace = traces.get(id);
  if (!trace) return;

  trace.steps.push({
    step,
    time: Date.now(),
    data,
  });
}

function endTrace(id) {
  const trace = traces.get(id);
  if (!trace) return null;

  trace.finished = Date.now();
  const completed = { ...trace };
  traces.delete(id);
  global.activeTraces = traces.size;
  return completed;
}

function getTrace(id) {
  return traces.get(id);
}

module.exports = {
  startTrace,
  traceStep,
  endTrace,
  getTrace,
};
