'use strict';

const VALID_PURPOSES = ['anticipation', 'reaction', 'velocity', 'acceleration'];

function validateProfile(profile, windowName) {
  if (!profile) {
    throw new Error(`Window ${windowName} has no content_profile`);
  }

  if (!VALID_PURPOSES.includes(profile.purpose)) {
    throw new Error(`Window ${windowName} has invalid purpose: ${profile.purpose}`);
  }

  if (!Array.isArray(profile.signals) || profile.signals.length === 0) {
    throw new Error(`Window ${windowName} has empty signals array`);
  }

  if (!profile.signal_weights || typeof profile.signal_weights !== 'object' || Array.isArray(profile.signal_weights)) {
    throw new Error(`Window ${windowName} missing signal_weights`);
  }

  for (const signalName of profile.signals) {
    if (!(signalName in profile.signal_weights)) {
      throw new Error(`Window ${windowName} signal ${signalName} missing weight`);
    }
  }

  return profile;
}

module.exports = {
  validateProfile,
  VALID_PURPOSES,
};