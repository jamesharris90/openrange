'use strict';

const PREMARKET = require('./premarket');
const OPEN = require('./open');
const POWER_HOUR = require('./power_hour');
const POST_MARKET = require('./post_market');

const WINDOWS = {
  premarket: PREMARKET,
  open: OPEN,
  power_hour: POWER_HOUR,
  post_market: POST_MARKET,
};

const WINDOW_NAMES = Object.keys(WINDOWS);

function getWindow(name) {
  if (!WINDOWS[name]) {
    throw new Error(`Unknown window: ${name}. Valid: ${WINDOW_NAMES.join(', ')}`);
  }
  return WINDOWS[name];
}

module.exports = {
  WINDOWS,
  WINDOW_NAMES,
  getWindow,
  PREMARKET,
  OPEN,
  POWER_HOUR,
  POST_MARKET,
};
