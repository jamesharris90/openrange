function successResponse(data, meta = {}) {
  const normalizedData = Array.isArray(data) ? data : [];

  return {
    success: true,
    count: normalizedData.length,
    data: normalizedData,
    meta,
  };
}

function errorResponse(message, meta = {}) {
  return {
    success: false,
    error: message,
    meta,
  };
}

module.exports = {
  successResponse,
  errorResponse,
};
