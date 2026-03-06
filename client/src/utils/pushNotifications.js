const STORAGE_KEY = 'openrange:push-alert-prefs';

const DEFAULT_PREFS = {
  enabled: false,
  priceAlerts: true,
  signalAlerts: true,
  newsAlerts: true,
};

export function getAlertPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setAlertPreferences(next) {
  const merged = { ...DEFAULT_PREFS, ...(next || {}) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

async function sendSubscriptionToBackend(subscription, prefs) {
  try {
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, prefs }),
    });
  } catch {
    // Backend endpoint may not yet exist; client-side prep still complete.
  }
}

export async function ensurePushSubscription(vapidPublicKey, prefs = getAlertPreferences()) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported on this device.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await sendSubscriptionToBackend(existing, prefs);
    return existing;
  }

  if (!vapidPublicKey) {
    throw new Error('Missing VAPID public key. Set VITE_VAPID_PUBLIC_KEY.');
  }

  const convertedVapid = Uint8Array.from(atob(vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedVapid,
  });

  await sendSubscriptionToBackend(subscription, prefs);
  return subscription;
}
