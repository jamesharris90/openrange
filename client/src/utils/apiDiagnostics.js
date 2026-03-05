export function logApiCall(path) {
  if (import.meta.env.DEV) {
    console.log('API request:', path);
  }
}
