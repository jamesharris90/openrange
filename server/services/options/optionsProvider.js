async function getExpirations() {
  throw new Error('optionsProvider contract only. Configure a concrete provider implementation.');
}

async function getOptionChain() {
  throw new Error('optionsProvider contract only. Configure a concrete provider implementation.');
}

async function getATMContract() {
  throw new Error('optionsProvider contract only. Configure a concrete provider implementation.');
}

async function getExpectedMove() {
  throw new Error('optionsProvider contract only. Configure a concrete provider implementation.');
}

module.exports = {
  getExpirations,
  getOptionChain,
  getATMContract,
  getExpectedMove,
};