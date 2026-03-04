const baseLogger = require('../logger');

function withMeta(meta = {}) {
  return {
    ...meta,
    scope: 'ingestion',
  };
}

function info(message, meta = {}) {
  baseLogger.info(message, withMeta(meta));
}

function warn(message, meta = {}) {
  baseLogger.warn(message, withMeta(meta));
}

function error(message, meta = {}) {
  baseLogger.error(message, withMeta(meta));
}

module.exports = {
  info,
  warn,
  error,
};
