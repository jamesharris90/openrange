const sharedEventBus = require('../events/eventBus');

if (!sharedEventBus.__openrangeMetricsInstalled) {
  sharedEventBus.events = 0;
  sharedEventBus.lastMinuteEvents = 0;
  sharedEventBus._minuteCounter = 0;

  const originalEmit = sharedEventBus.emit.bind(sharedEventBus);
  sharedEventBus.emit = function patchedEmit(event, ...args) {
    sharedEventBus.events += 1;
    sharedEventBus._minuteCounter += 1;
    return originalEmit(event, ...args);
  };

  setInterval(() => {
    sharedEventBus.lastMinuteEvents = sharedEventBus._minuteCounter;
    sharedEventBus._minuteCounter = 0;
    global.eventBusRate = sharedEventBus.lastMinuteEvents;
  }, 60 * 1000).unref();

  sharedEventBus.__openrangeMetricsInstalled = true;
}

function publish(event, payload) {
  return sharedEventBus.emit(event, payload);
}

function getEventBusMetrics() {
  return {
    events: sharedEventBus.events || 0,
    eventsPerMinute: sharedEventBus.lastMinuteEvents || 0,
  };
}

module.exports = {
  eventBus: sharedEventBus,
  publish,
  getEventBusMetrics,
};
