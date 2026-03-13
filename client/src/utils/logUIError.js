import { apiFetch } from '../api/apiClient';

export async function logUIError(payload = {}) {
  try {
    await apiFetch('/system/ui-error', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (_error) {
    // Do not throw from UI telemetry.
  }
}
