const EventEmitter = require('events');

class OpenRangeEventBus extends EventEmitter {}

const eventBus = new OpenRangeEventBus();
eventBus.setMaxListeners(100);

module.exports = eventBus;
