function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveFallback(fallbackValue) {
  if (typeof fallbackValue === 'function') {
    return fallbackValue();
  }
  return fallbackValue;
}

export async function fetchSafeResponse(url, options = {}) {
  const {
    fallback = null,
    validate,
    returnFallbackOnError = false,
  } = options;

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      if (returnFallbackOnError) {
        return resolveFallback(fallback);
      }
      const body = await response.text();
      throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      if (returnFallbackOnError) {
        return resolveFallback(fallback);
      }
      throw new Error('Non-JSON response');
    }

    const json = await response.json();

    if (typeof validate === 'function' && !validate(json)) {
      return resolveFallback(fallback);
    }

    return json;
  } catch (error) {
    if (returnFallbackOnError) {
      return resolveFallback(fallback);
    }
    throw error;
  }
}

export async function fetchSafeRaw(url, options = {}) {
  const {
    fallback = null,
    returnFallbackOnError = false,
  } = options;

  try {
    return await fetch(url, options);
  } catch (error) {
    if (returnFallbackOnError) {
      return resolveFallback(fallback);
    }
    throw error;
  }
}

export async function fetchSafe(url, options = {}) {
  const {
    fallback = [],
    arrayOnly = false,
    validate,
  } = options;

  const fallbackValue = resolveFallback(fallback);

  const json = await fetchSafeResponse(url, {
    ...options,
    fallback: fallbackValue,
    returnFallbackOnError: true,
  });

  if (json === fallbackValue) {
    return fallbackValue;
  }

  if (!isObject(json)) {
    return fallbackValue;
  }

  if (Object.prototype.hasOwnProperty.call(json, 'success') && !json.success) {
    return fallbackValue;
  }

  if (arrayOnly) {
    const candidate = Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
    return Array.isArray(candidate) ? candidate : fallbackValue;
  }

  if (typeof validate === 'function') {
    return validate(json) ? json : fallbackValue;
  }

  return json;
}
